package com.workbench.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.ClipData;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Color;
import android.graphics.Typeface;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.text.TextUtils;
import android.util.Base64;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

import com.google.zxing.integration.android.IntentIntegrator;
import com.google.zxing.integration.android.IntentResult;
import com.journeyapps.barcodescanner.ScanOptions;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * 个人工作台安卓壳：全屏 WebView 加载工作台服务。
 * 首次启动填写服务器地址，之后自动进入；断线显示重试页；支持上传选图与文件下载。
 */
public class MainActivity extends Activity {

    private static final String PREFS = "workbench";
    private static final String KEY_SERVER_URL = "server_url";
    /** 已保存的多条访问地址（局域网 / 隧道），JSON 数组字符串。 */
    private static final String KEY_NETWORKS = "saved_networks";
    private static final int FILE_CHOOSER_REQUEST = 1001;
    private static final int STORAGE_PERMISSION_REQUEST = 1002;
    /** 原生选图/选文件（AppBridge.pickFiles）的返回码。 */
    private static final int PICK_FILES_REQUEST = 1003;
    /** Android 13+ 通知权限的申请码（上传保活通知用）。 */
    private static final int NOTIFICATION_PERMISSION_REQUEST = 1004;
    /** 单个文件上限：base64 经 evaluateJavascript 回传会放大约 1/3，更大的文件请走电脑端上传。 */
    private static final int MAX_PICKED_BYTES = 25 * 1024 * 1024;
    /** 视频单文件上限（与服务器 200MB 一致）；分块回传下不再受"整包 base64"的内存限制。 */
    private static final long MAX_PICKED_VIDEO_BYTES = 200L * 1024 * 1024;
    /** 分块回传的块大小：原生与网页的内存峰值都压到这一块的量级。 */
    private static final int PICK_CHUNK_BYTES = 2 * 1024 * 1024;
    /** 相册里的子目录，便于用户在工作台 App 存图后一眼找到。 */
    private static final String GALLERY_FOLDER = "个人工作台";
    /** 只接管「图片地址」的长按，避免把普通链接当成图片存进相册。 */
    private static final Pattern IMAGE_URL_PATTERN =
            Pattern.compile("\\.(png|jpe?g|webp|gif|bmp)(\\?.*)?$", Pattern.CASE_INSENSITIVE);
    /** 列表里的缩略图地址，长按它不保存：存进相册的是 240px 小图，用户拿去用会糊。 */
    private static final String THUMB_PATH = "/api/thumbs/";

    private WebView webView;
    /** 渲染进程被系统回收后重建 WebView 时，用它把页面重新加载回来。 */
    private String lastLoadedUrl;
    private SwipeRefreshLayout swipeRefresh;
    private ProgressBar loadProgress;
    private View browserView;
    private View setupView;
    private View networkView;
    private LinearLayout networkList;
    private EditText urlInput;
    private TextView testResult;
    private Button testButton;

    private ValueCallback<Uri[]> fileCallback;
    /** 进行中的原生选文件请求：网页端传入的 requestId，结果回传时原样带回。 */
    private String pendingPickRequestId;
    private int pendingPickMax = 1;
    /** API 29 以下保存图片前要先申请存储权限，授权通过后接着保存这一张。 */
    private String pendingImageUrl;
    private String pendingImageName;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        webView = findViewById(R.id.web_view);
        swipeRefresh = findViewById(R.id.swipe_refresh);
        loadProgress = findViewById(R.id.load_progress);
        browserView = findViewById(R.id.browser_view);
        setupView = findViewById(R.id.setup_view);
        networkView = findViewById(R.id.network_view);
        networkList = findViewById(R.id.network_list);
        urlInput = findViewById(R.id.url_input);
        testResult = findViewById(R.id.test_result);
        testButton = findViewById(R.id.test_button);

        configureWebView();
        bindSetupButtons();
        bindErrorButtons();

        String savedUrl = preferences().getString(KEY_SERVER_URL, "");
        if (TextUtils.isEmpty(savedUrl)) {
            showView(setupView);
        } else {
            loadServer(savedUrl);
        }
    }

    private SharedPreferences preferences() {
        return getSharedPreferences(PREFS, MODE_PRIVATE);
    }

    /** 渲染进程崩溃后的自救：销毁已经坏掉的 WebView，在原位置重建并重新加载页面。 */
    private void recreateWebViewAfterCrash() {
        try {
            ViewGroup parent = webView.getParent() instanceof ViewGroup ? (ViewGroup) webView.getParent() : null;
            ViewGroup.LayoutParams params = webView.getLayoutParams();
            int index = parent == null ? -1 : parent.indexOfChild(webView);
            if (parent != null) parent.removeView(webView);
            webView.destroy();
            WebView fresh = new WebView(this);
            webView = fresh;
            if (parent != null) parent.addView(fresh, index, params);
            configureWebView();
            swipeRefresh.setRefreshing(false);
            if (!TextUtils.isEmpty(lastLoadedUrl)) webView.loadUrl(lastLoadedUrl);
        } catch (Exception error) {
            // 重建失败也不能让 App 死：退回设置页，用户可手动重进。
            showView(setupView);
        }
    }

    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setMediaPlaybackRequiresUserGesture(true);
        // 网页里的「上传图片/附件」依赖 WebView 打开系统文件选择器，这里显式打开文件与内容访问，
        // 避免个别 ROM 默认关闭后出现「点了上传没有任何反应」。
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        webView.setBackgroundColor(Color.TRANSPARENT);

        swipeRefresh.setColorSchemeColors(getColor(R.color.brand_teal));
        // 下拉刷新：只在 WebView 已经滚到顶部时才允许触发（用 getScrollY 自己判断，
        // 不使用默认的 canScrollVertically 探测——页面用内部滚动容器时它会误判成“不能滚动”，
        // 导致往下滑列表也被当成下拉刷新并吃掉手势）。
        swipeRefresh.setOnChildScrollUpCallback((parent, child) -> webView.getScrollY() > 0);
        swipeRefresh.setOnRefreshListener(() -> webView.reload());

        // 网络选择收进网页「设置 → 手机连接」：页面通过该桥接读取/切换已保存的网络。
        webView.addJavascriptInterface(new AppBridge(), "workbenchApp");

        webView.setWebViewClient(new WebViewClient() {            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String scheme = uri.getScheme() == null ? "" : uri.getScheme();
                if (scheme.equals("http") || scheme.equals("https") || scheme.equals("blob")
                        || scheme.equals("data") || scheme.equals("about")) {
                    return false; // 站内导航交给 WebView
                }
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (Exception ignored) {
                }
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                swipeRefresh.setRefreshing(false);
                loadProgress.setProgress(0);
                if (networkView.getVisibility() != View.VISIBLE) {
                    showView(browserView);
                }
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (!request.isForMainFrame()) return;
                // 连不上时不自动切换，直接进入手动选择网络页（逐条显示可用性）。
                showNetworkPage();
            }

            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                // 渲染进程被系统回收（最常见的原因是上传大图时内存不足）。默认行为是整个
                // App 跟着一起闪退，这里是唯一的兜底：提示后重建 WebView 重新加载页面。
                // 上传队列在网页端有本地续传，没传完的图会提示「继续上传」，不会丢。
                if (webView == view) {
                    Toast.makeText(MainActivity.this, R.string.page_out_of_memory_reloading, Toast.LENGTH_LONG).show();
                    recreateWebViewAfterCrash();
                }
                return true;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                loadProgress.setProgress(newProgress);
                loadProgress.setVisibility(newProgress >= 100 ? View.GONE : View.VISIBLE);
            }

            // 订单凭证、产品图片等上传入口依赖该回调调起系统选图/拍照。
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                // 上一次回调没释放会让后续所有点击都失效，先兜底释放掉。
                releaseFileCallback();
                fileCallback = callback;
                if (!startFileChooser(params)) {
                    // 绝不静默失败：既要在界面上给出提示，也要释放回调让文件框复位，
                    // 否则使用者看到的就是「点了上传没有任何反应」。
                    releaseFileCallback();
                    Toast.makeText(MainActivity.this, R.string.file_chooser_unavailable, Toast.LENGTH_LONG).show();
                }
                return true;
            }
        });

        // 备份 ZIP、PDF 等下载交给系统下载器，并带上登录 Cookie。
        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
            try {
                DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
                String cookie = CookieManager.getInstance().getCookie(url);
                if (cookie != null) {
                    request.addRequestHeader("Cookie", cookie);
                }
                request.setMimeType(mimeType);
                request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS,
                        android.webkit.URLUtil.guessFileName(url, contentDisposition, mimeType));
                DownloadManager manager = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                manager.enqueue(request);
                Toast.makeText(this, R.string.download_started, Toast.LENGTH_SHORT).show();
            } catch (Exception e) {
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                } catch (Exception ignored) {
                }
            }
        });

        // 长按图片保存：桌面 Chrome 会弹「保存图片」，WebView 根本不会——不接管的话，
        // 页面里「长按大图保存到相册」的提示在 App 内点了没有任何反应，用户只会觉得存不上。
        webView.setOnLongClickListener(view -> {
            WebView.HitTestResult hit = webView.getHitTestResult();
            if (hit == null) return false;
            int type = hit.getType();
            if (type != WebView.HitTestResult.IMAGE_TYPE
                    && type != WebView.HitTestResult.SRC_IMAGE_ANCHOR_TYPE) {
                return false; // 文字选择、超链接长按等交回 WebView 默认行为
            }
            String source = hit.getExtra();
            if (TextUtils.isEmpty(source) || !IMAGE_URL_PATTERN.matcher(source).find()) return false;
            if (source.contains(THUMB_PATH)) return false; // 缩略图不存，大图和「保存到相册」按钮才是原图
            saveImageToGallery(source, null);
            return true;
        });
    }

    /** 释放文件选择回调：不释放会让网页里的 file input 一直停在待选状态，后续点击全部无效。 */
    private void releaseFileCallback() {
        if (fileCallback != null) {
            fileCallback.onReceiveValue(null);
            fileCallback = null;
        }
    }

    /**
     * 调起系统选图/拍照。先试 WebView 自带意图（带拍照入口），
     * 再退回自建的 ACTION_OPEN_DOCUMENT，避免个别 ROM 上直接抛异常导致上传没有反应。
     */
    private boolean startFileChooser(WebChromeClient.FileChooserParams params) {
        Intent primary = null;
        try {
            primary = params.createIntent();
            if (primary != null) {
                primary.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            }
        } catch (Exception ignored) {
        }
        if (tryStartActivity(primary)) return true;
        return tryStartActivity(buildFallbackChooserIntent(params));
    }

    private boolean tryStartActivity(Intent intent) {
        if (intent == null) return false;
        try {
            startActivityForResult(intent, FILE_CHOOSER_REQUEST);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /** 兜底选择器：ACTION_OPEN_DOCUMENT + CATEGORY_OPENABLE，按网页 accept 限制类型。 */
    private Intent buildFallbackChooserIntent(WebChromeClient.FileChooserParams params) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        String[] acceptTypes = null;
        try {
            acceptTypes = params.getAcceptTypes();
        } catch (Exception ignored) {
        }
        if (acceptTypes != null && acceptTypes.length == 1 && !TextUtils.isEmpty(acceptTypes[0])) {
            intent.setType(acceptTypes[0]);
        } else {
            intent.setType("*/*");
            if (acceptTypes != null && acceptTypes.length > 1) {
                intent.putExtra(Intent.EXTRA_MIME_TYPES, acceptTypes);
            }
        }
        try {
            if (params.getMode() == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE) {
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            }
        } catch (Exception ignored) {
        }
        return intent;
    }

    // ===== 原生选图/选文件（AppBridge.pickFiles）=====

    /** 拉起系统选择器。图片走系统照片选择器（Android 13+）或 OPEN_DOCUMENT image/*，其他文件走 OPEN_DOCUMENT。 */
    private boolean launchFilePicker(String acceptJson, boolean multiple, int maxCount, String requestId) {
        List<String> accept = parseAcceptTypes(acceptJson);
        boolean imagesOnly = accept.size() == 1 && "image/*".equals(accept.get(0));
        Intent intent;
        if (imagesOnly && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            // 系统照片选择器：体验最好，不需要任何存储权限。
            intent = new Intent(MediaStore.ACTION_PICK_IMAGES);
            if (multiple) {
                intent.putExtra(MediaStore.EXTRA_PICK_IMAGES_MAX,
                        Math.min(Math.max(maxCount, 1), MediaStore.getPickImagesMaxLimit()));
            }
        } else {
            intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            // 附件是混合类型时直接用 */*：部分 ROM 对生僻 MIME 过滤过严，会一个文件都选不了。
            intent.setType(imagesOnly ? "image/*" : "*/*");
            if (multiple) intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        }
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        pendingPickRequestId = requestId;
        pendingPickMax = Math.max(1, maxCount);
        try {
            startActivityForResult(intent, PICK_FILES_REQUEST);
            return true;
        } catch (Exception error) {
            pendingPickRequestId = null;
            Toast.makeText(this, R.string.file_chooser_unavailable, Toast.LENGTH_LONG).show();
            return false;
        }
    }

    private List<String> parseAcceptTypes(String acceptJson) {
        List<String> accept = new ArrayList<>();
        if (!TextUtils.isEmpty(acceptJson)) {
            try {
                JSONArray array = new JSONArray(acceptJson);
                for (int index = 0; index < array.length(); index += 1) {
                    String type = array.optString(index, "").trim();
                    if (!type.isEmpty()) accept.add(type);
                }
            } catch (JSONException ignored) {
            }
        }
        if (accept.isEmpty()) accept.add("image/*");
        return accept;
    }

    /** 读取选中的文件并回传给网页：读字节走后台线程，回传（evaluateJavascript）回 UI 线程。 */
    private void handlePickedFiles(int resultCode, Intent data) {
        final String requestId = pendingPickRequestId;
        final int max = pendingPickMax;
        pendingPickRequestId = null;
        if (requestId == null) return;
        List<Uri> uris = new ArrayList<>();
        if (resultCode == RESULT_OK && data != null) {
            ClipData clip = data.getClipData();
            if (clip != null) {
                for (int index = 0; index < clip.getItemCount() && uris.size() < max; index += 1) {
                    uris.add(clip.getItemAt(index).getUri());
                }
            } else if (data.getData() != null) {
                uris.add(data.getData());
            }
        }
        if (uris.isEmpty()) {
            // 取消也要回执，否则网页端的 Promise 会一直挂着。
            deliverPickedFiles(requestId, new JSONArray());
            return;
        }
        // 先问页面端支不支持逐张回传：新版页面（缓存已更新的）走 __workbenchPickedFile，
        // 一次只把一张图的字节交给页面 —— 选多张大图时原生和网页两边都只占一张图的内存；
        // 旧页面退回原来的整批回传，保证装新壳后旧缓存页面也能用。
        mainHandler.post(() -> {
            if (webView == null) {
                deliverPickedFilesLegacy(requestId, uris);
                return;
            }
            webView.evaluateJavascript("typeof window.__workbenchPickedFileBegin==='function'", chunkedValue -> {
                if ("true".equals(chunkedValue)) {
                    deliverPickedFilesChunked(requestId, uris);
                    return;
                }
                webView.evaluateJavascript("typeof window.__workbenchPickedFile==='function'", value -> {
                    if ("true".equals(value)) deliverPickedFilesStreaming(requestId, uris);
                    else deliverPickedFilesLegacy(requestId, uris);
                });
            });
        });
    }

    /** 新协议（1.17 页面）：按 2MB 一块边读边发，配 Begin/Chunk/End/Abort，视频等大文件内存只占一块。 */
    private void deliverPickedFilesChunked(String requestId, List<Uri> uris) {
        final String quotedId = JSONObject.quote(requestId);
        executor.execute(() -> {
            int failed = 0;
            for (Uri uri : uris) {
                try {
                    deliverOneFileChunked(quotedId, uri);
                } catch (Exception error) {
                    failed += 1;
                }
            }
            final int failedCount = failed;
            mainHandler.post(() -> {
                if (webView == null) return;
                if (failedCount > 0) {
                    Toast.makeText(MainActivity.this, R.string.pick_files_partial_failed, Toast.LENGTH_LONG).show();
                }
                webView.evaluateJavascript(
                        "window.__workbenchPickedFilesDone&&window.__workbenchPickedFilesDone(" + quotedId + ");", null);
            });
        });
    }

    /** 读一个文件并分块回传；超大（声明或实际字节超上限）就中止这一个、其余照常。 */
    private void deliverOneFileChunked(String quotedId, Uri uri) throws IOException {
        String name = queryDisplayName(uri);
        String type = getContentResolver().getType(uri);
        boolean video = isVideoLike(name, type);
        if (TextUtils.isEmpty(type)) type = video ? "video/mp4" : "application/octet-stream";
        long maxBytes = video ? MAX_PICKED_VIDEO_BYTES : MAX_PICKED_BYTES;
        if (queryDisplaySize(uri) > maxBytes) throw new IOException("file too large");
        try (InputStream input = getContentResolver().openInputStream(uri)) {
            if (input == null) throw new IOException("open failed");
            byte[] buffer = new byte[PICK_CHUNK_BYTES];
            long total = 0;
            boolean begun = false;
            int read;
            while ((read = input.read(buffer)) != -1) {
                total += read;
                if (total > maxBytes) {
                    // 声明大小不可靠时边读边卡；已经发过的块让页面丢弃，别让半个文件冒充完整。
                    if (begun) waitForEvaluateJavascript("window.__workbenchPickedFileAbort&&window.__workbenchPickedFileAbort(" + quotedId + ");");
                    throw new IOException("file too large");
                }
                String base64 = Base64.encodeToString(buffer, 0, read, Base64.NO_WRAP);
                if (!begun) {
                    begun = true;
                    waitForEvaluateJavascript("window.__workbenchPickedFileBegin&&window.__workbenchPickedFileBegin("
                            + quotedId + "," + JSONObject.quote(name) + "," + JSONObject.quote(type) + ");");
                }
                waitForEvaluateJavascript("window.__workbenchPickedFileChunk&&window.__workbenchPickedFileChunk("
                        + quotedId + "," + JSONObject.quote(base64) + ");");
            }
            if (total == 0) throw new IOException("empty file");
            waitForEvaluateJavascript("window.__workbenchPickedFileEnd&&window.__workbenchPickedFileEnd(" + quotedId + ");");
        }
    }

    /** 后台线程同步等一次 evaluateJavascript 执行完：分块必须按顺序送达。 */
    private void waitForEvaluateJavascript(String script) {
        final CountDownLatch latch = new CountDownLatch(1);
        mainHandler.post(() -> {
            if (webView == null) {
                latch.countDown();
                return;
            }
            webView.evaluateJavascript(script, value -> latch.countDown());
        });
        try {
            latch.await(10, TimeUnit.SECONDS);
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
        }
    }

    private static boolean isVideoLike(String name, String type) {
        if (type != null && type.startsWith("video/")) return true;
        String lower = name == null ? "" : name.toLowerCase();
        return lower.endsWith(".mp4") || lower.endsWith(".mov") || lower.endsWith(".m4v") || lower.endsWith(".webm");
    }

    private long queryDisplaySize(Uri uri) {
        try (Cursor cursor = getContentResolver().query(uri, null, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(OpenableColumns.SIZE);
                if (index >= 0 && !cursor.isNull(index)) return cursor.getLong(index);
            }
        } catch (Exception ignored) {
        }
        return -1;
    }

    /** 旧协议：整批读进内存、拼一个 JSON 一次回传（页面端还是旧版缓存时用）。 */
    private void deliverPickedFilesLegacy(String requestId, List<Uri> uris) {
        executor.execute(() -> {
            JSONArray files = new JSONArray();
            int failed = 0;
            for (Uri uri : uris) {
                try {
                    files.put(readPickedFile(uri));
                } catch (Exception error) {
                    failed += 1;
                }
            }
            final JSONArray result = files;
            final int failedCount = failed;
            mainHandler.post(() -> {
                if (failedCount > 0) {
                    Toast.makeText(MainActivity.this, R.string.pick_files_partial_failed, Toast.LENGTH_LONG).show();
                }
                deliverPickedFiles(requestId, result);
            });
        });
    }

    /** 新协议：一张一张读、一张一张交给页面，最后发 __workbenchPickedFilesDone 收尾。 */
    private void deliverPickedFilesStreaming(String requestId, List<Uri> uris) {
        final String quotedId = JSONObject.quote(requestId);
        executor.execute(() -> {
            int failed = 0;
            for (Uri uri : uris) {
                String payload;
                try {
                    payload = readPickedFile(uri).toString();
                } catch (Exception error) {
                    failed += 1;
                    continue;
                }
                final String item = payload;
                final CountDownLatch delivered = new CountDownLatch(1);
                mainHandler.post(() -> {
                    if (webView == null) {
                        delivered.countDown();
                        return;
                    }
                    webView.evaluateJavascript(
                            "window.__workbenchPickedFile&&window.__workbenchPickedFile(" + quotedId + "," + item + ");",
                            value -> delivered.countDown());
                });
                try {
                    // 等这一张真正进了页面再读下一张：内存峰值就是一张图的字节数。
                    delivered.await(10, TimeUnit.SECONDS);
                } catch (InterruptedException ignored) {
                }
            }
            final int failedCount = failed;
            mainHandler.post(() -> {
                if (webView == null) return;
                if (failedCount > 0) {
                    Toast.makeText(MainActivity.this, R.string.pick_files_partial_failed, Toast.LENGTH_LONG).show();
                }
                webView.evaluateJavascript(
                        "window.__workbenchPickedFilesDone&&window.__workbenchPickedFilesDone(" + quotedId + ");", null);
            });
        });
    }

    /** Android 13+ 上传保活通知需要运行时权限；拒绝也不影响上传，只是通知不显示。 */
    private void ensureNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, NOTIFICATION_PERMISSION_REQUEST);
        }
    }

    private JSONObject readPickedFile(Uri uri) throws IOException, JSONException {
        byte[] bytes;
        try (InputStream input = getContentResolver().openInputStream(uri)) {
            if (input == null) throw new IOException("open failed");
            bytes = readAllBytes(input);
        }
        if (bytes.length == 0) throw new IOException("empty file");
        if (bytes.length > MAX_PICKED_BYTES) throw new IOException("file too large");
        String type = getContentResolver().getType(uri);
        if (TextUtils.isEmpty(type)) type = "application/octet-stream";
        JSONObject item = new JSONObject();
        item.put("name", queryDisplayName(uri));
        item.put("type", type);
        item.put("size", bytes.length);
        item.put("data", Base64.encodeToString(bytes, Base64.NO_WRAP));
        return item;
    }

    /** 从 content:// 取用户看到的原始文件名，取不到就用时间戳兜底。 */
    private String queryDisplayName(Uri uri) {
        try (Cursor cursor = getContentResolver().query(uri, null, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (index >= 0) {
                    String name = cursor.getString(index);
                    if (!TextUtils.isEmpty(name)) return name;
                }
            }
        } catch (Exception ignored) {
        }
        return "file-" + System.currentTimeMillis();
    }

    private void deliverPickedFiles(String requestId, JSONArray files) {
        if (webView == null) return;
        webView.evaluateJavascript("window.__workbenchPickedFiles&&window.__workbenchPickedFiles("
                + JSONObject.quote(requestId) + "," + files + ");", null);
    }

    private byte[] readAllBytes(InputStream input) throws IOException {
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        byte[] chunk = new byte[8192];
        int read;
        while ((read = input.read(chunk)) != -1) {
            buffer.write(chunk, 0, read);
        }
        return buffer.toByteArray();
    }

    private void bindSetupButtons() {
        Button enterButton = findViewById(R.id.enter_button);
        testButton.setOnClickListener(v -> {
            String url = normalizeUrl(urlInput.getText().toString());
            if (url == null) {
                showTestResultText(getString(R.string.scan_invalid), R.color.danger);
                return;
            }
            runConnectionTest(url);
        });
        // 扫描电脑「设置 → 手机连接」页面上的二维码，自动填入地址并测试连接。
        findViewById(R.id.scan_button).setOnClickListener(v -> {
            IntentIntegrator integrator = new IntentIntegrator(this);
            integrator.setDesiredBarcodeFormats(ScanOptions.QR_CODE);
            integrator.setPrompt(getString(R.string.scan_prompt));
            integrator.setBeepEnabled(false);
            integrator.setOrientationLocked(false);
            integrator.initiateScan();
        });
        enterButton.setOnClickListener(v -> {
            String url = normalizeUrl(urlInput.getText().toString());
            if (url == null) {
                showTestResultText(getString(R.string.scan_invalid), R.color.danger);
                return;
            }
            rememberNetwork(labelFor(url), url);
            loadServer(url);
        });
    }

    private void runConnectionTest(String url) {
        testButton.setEnabled(false);
        showTestResult(-1, 0);
        executor.execute(() -> {
            HealthProbe probe = probeHealth(url);
            mainHandler.post(() -> {
                testButton.setEnabled(true);
                if (!probe.reachable) {
                    showTestResult(R.string.test_fail, R.color.danger);
                } else if ("test".equals(probe.environment)) {
                    showTestResultText(getString(R.string.test_ok_test, probe.latencyMs), R.color.env_test);
                } else if ("production".equals(probe.environment)) {
                    showTestResultText(getString(R.string.test_ok_production, probe.latencyMs), R.color.success);
                } else {
                    showTestResultText(getString(R.string.test_ok, probe.latencyMs), R.color.success);
                }
            });
        });
    }

    private void bindErrorButtons() {
        findViewById(R.id.network_rescan_button).setOnClickListener(v -> renderNetworkList());
        findViewById(R.id.network_retry_button).setOnClickListener(v ->
            loadServer(preferences().getString(KEY_SERVER_URL, "")));
        findViewById(R.id.network_edit_button).setOnClickListener(v -> openSetupView());
    }

    private void openSetupView() {
        urlInput.setText(preferences().getString(KEY_SERVER_URL, ""));
        showView(setupView);
    }

    private void loadServer(String url) {
        showView(browserView);
        lastLoadedUrl = url;
        webView.loadUrl(url);
    }

    // ===== 多条访问网络（局域网 / 隧道）=====

    /**
     * 暴露给工作台网页的原生桥接对象（window.workbenchApp）。
     * 页面只在 App 内渲染「App 网络」区块，用于查看与切换已保存的网络。
     */
    public class AppBridge {
        /** 已保存网络列表：JSON 数组 [{label, url, active}]。 */
        @JavascriptInterface
        public String getNetworks() {
            List<SavedNetwork> networks = loadNetworks();
            String active = preferences().getString(KEY_SERVER_URL, "");
            JSONArray array = new JSONArray();
            for (SavedNetwork network : networks) {
                JSONObject item = new JSONObject();
                try {
                    item.put("label", network.label);
                    item.put("url", network.url);
                    item.put("active", network.url.equals(active));
                } catch (JSONException ignored) {
                }
                array.put(item);
            }
            return array.toString();
        }

        /** 切换到指定网络（地址需为已保存的合法地址）。 */
        @JavascriptInterface
        public void switchNetwork(String url) {
            String normalized = normalizeUrl(url);
            if (normalized == null) return;
            runOnUiThread(() -> {
                preferences().edit().putString(KEY_SERVER_URL, normalized).apply();
                loadServer(normalized);
            });
        }

        /** 打开原生「连接工作台」页面，用于新增/编辑地址。 */
        @JavascriptInterface
        public void openAddressEditor() {
            runOnUiThread(MainActivity.this::openSetupView);
        }

        /**
         * 删除一条已保存的网络（网页「设置 → 手机连接 → App 网络」里的删除按钮）。
         * 这里必须写成 MainActivity.this.removeNetwork，否则会递归调用桥方法自己。
         */
        @JavascriptInterface
        public void removeNetwork(String url) {
            String normalized = normalizeUrl(url);
            if (normalized == null) return;
            runOnUiThread(() -> MainActivity.this.removeNetwork(normalized));
        }

        /**
         * 网页「保存到相册」按钮：由原生把图片下载下来写进系统相册。
         * 网页自己那条路（blob + a[download]）在 WebView 里会被静默忽略，只能走原生。
         */
        @JavascriptInterface
        public void saveImage(String url, String fileName) {
            runOnUiThread(() -> saveImageToGallery(url, fileName));
        }

        /**
         * 网页弹窗打开/关闭时调用：弹窗内部是独立滚动容器，期间必须禁用下拉刷新，
         * 否则弹窗里的下滑会被当成刷新页面、内容滑不动。
         */
        @JavascriptInterface
        public void setOverlayOpen(boolean open) {
            runOnUiThread(() -> {
                swipeRefresh.setEnabled(!open);
                if (open) swipeRefresh.setRefreshing(false);
            });
        }

        /**
         * 原生选图/选文件：部分 ROM 的 WebView 里 file input 的点击激活链整条失效
         * （点「添加图片」连系统选图界面都不弹，onShowFileChooser 根本不会被调用），
         * 所以 App 内由原生直接拉起系统选择器，彻底绕开这条不可靠的链路。
         * 结果经 window.__workbenchPickedFiles(requestId, files) 回传，
         * files 为 [{name, type, size, data(base64)}]，用户取消时回传空数组。
         * 返回 false 表示没能拉起，网页端会退回 <input type=file> 路径。
         */
        @JavascriptInterface
        public boolean pickFiles(final String acceptJson, final boolean multiple,
                                 final int maxCount, final String requestId) {
            // JS 桥方法跑在 JavaBridge 线程，startActivityForResult 必须回 UI 线程；
            // 用 CountDownLatch 同步拿到「是否成功拉起」，网页端才能立刻决定要不要走兜底。
            final CountDownLatch latch = new CountDownLatch(1);
            final boolean[] launched = {false};
            mainHandler.post(() -> {
                launched[0] = launchFilePicker(acceptJson, multiple, maxCount, requestId);
                latch.countDown();
            });
            try {
                latch.await(2, TimeUnit.SECONDS);
            } catch (InterruptedException error) {
                Thread.currentThread().interrupt();
            }
            return launched[0];
        }

        /**
         * 上传开始：拉起前台服务保活并显示通知栏进度。
         * 安卓在 App 退到后台后会把应用冻结、上传随之停住；挂着前台服务就能继续传。
         */
        @JavascriptInterface
        public void startUploadKeepAlive(String text, int done, int total) {
            runOnUiThread(() -> {
                ensureNotificationPermission();
                UploadKeepAliveService.start(MainActivity.this, text, done, total);
            });
        }

        /** 上传进度变化：更新通知里的文字与进度条。 */
        @JavascriptInterface
        public void updateUploadKeepAlive(String text, int done, int total) {
            runOnUiThread(() -> UploadKeepAliveService.start(MainActivity.this, text, done, total));
        }

        /** 上传结束（全部成功或最终失败）：收掉通知与前台服务。 */
        @JavascriptInterface
        public void stopUploadKeepAlive() {
            runOnUiThread(() -> UploadKeepAliveService.stop(MainActivity.this));
        }
    }

    /** 一条已保存的访问地址。 */
    private static final class SavedNetwork {
        final String label;
        final String url;

        SavedNetwork(String label, String url) {
            this.label = label;
            this.url = url;
        }
    }

    private List<SavedNetwork> loadNetworks() {
        List<SavedNetwork> networks = new ArrayList<>();
        String raw = preferences().getString(KEY_NETWORKS, "");
        if (!TextUtils.isEmpty(raw)) {
            try {
                JSONArray array = new JSONArray(raw);
                for (int index = 0; index < array.length(); index += 1) {
                    JSONObject item = array.optJSONObject(index);
                    if (item == null) continue;
                    String url = item.optString("url", "");
                    if (!TextUtils.isEmpty(url)) {
                        networks.add(new SavedNetwork(item.optString("label", labelFor(url)), url));
                    }
                }
            } catch (JSONException ignored) {
            }
        }
        // 兼容旧版本只保存单地址的情况
        String active = preferences().getString(KEY_SERVER_URL, "");
        if (!TextUtils.isEmpty(active)) {
            boolean known = false;
            for (SavedNetwork network : networks) {
                if (network.url.equals(active)) {
                    known = true;
                    break;
                }
            }
            if (!known) networks.add(new SavedNetwork(labelFor(active), active));
        }
        return networks;
    }

    private void persistNetworks(List<SavedNetwork> networks) {
        JSONArray array = new JSONArray();
        for (SavedNetwork network : networks) {
            JSONObject item = new JSONObject();
            try {
                item.put("label", network.label);
                item.put("url", network.url);
            } catch (JSONException ignored) {
            }
            array.put(item);
        }
        preferences().edit().putString(KEY_NETWORKS, array.toString()).apply();
    }

    /** 记住一条地址并设为当前使用（同地址去重后置顶）。 */
    private void rememberNetwork(String label, String url) {
        List<SavedNetwork> networks = loadNetworks();
        networks.removeIf((network) -> network.url.equals(url));
        networks.add(0, new SavedNetwork(label, url));
        persistNetworks(networks);
        preferences().edit().putString(KEY_SERVER_URL, url).apply();
    }

    /** 按地址推断网络类型，用于列表展示。 */
    private String labelFor(String url) {
        try {
            String host = Uri.parse(url).getHost();
            if (host == null) return "地址";
            if (host.startsWith("192.168.") || host.startsWith("10.") || host.startsWith("172.")) return "局域网";
            if (host.startsWith("127.") || host.equalsIgnoreCase("localhost")) return "本机";
            return "隧道";
        } catch (Exception error) {
            return "地址";
        }
    }

    /** 手动选择网络页：列出已保存的网络并逐个探测可用性，点击即连接。 */
    private void showNetworkPage() {
        showView(networkView);
        renderNetworkList();
    }

    private void renderNetworkList() {
        networkList.removeAllViews();
        List<SavedNetwork> networks = loadNetworks();
        String active = preferences().getString(KEY_SERVER_URL, "");
        if (networks.isEmpty()) {
            TextView empty = new TextView(this);
            empty.setText(R.string.network_page_empty);
            empty.setTextColor(getColor(R.color.text_muted));
            empty.setTextSize(14);
            networkList.addView(empty);
            return;
        }

        final Map<String, TextView> statusViews = new LinkedHashMap<>();
        for (SavedNetwork network : networks) {
            // 行 = 左侧信息区（点哪条连哪条）+ 右侧删除按钮：保存过的地址原来只增不减。
            LinearLayout row = new LinearLayout(this);
            row.setOrientation(LinearLayout.HORIZONTAL);
            row.setGravity(Gravity.CENTER_VERTICAL);
            row.setPadding(dp(14), dp(10), dp(6), dp(10));
            LinearLayout.LayoutParams rowParams = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            rowParams.bottomMargin = dp(8);
            row.setLayoutParams(rowParams);
            row.setBackgroundResource(R.drawable.input_bg);

            LinearLayout content = new LinearLayout(this);
            content.setOrientation(LinearLayout.VERTICAL);
            content.setLayoutParams(new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));

            TextView title = new TextView(this);
            title.setText(network.url.equals(active)
                    ? getString(R.string.network_row_current, network.label)
                    : network.label);
            title.setTextColor(getColor(R.color.text_main));
            title.setTextSize(15);
            title.setTypeface(title.getTypeface(), Typeface.BOLD);

            TextView address = new TextView(this);
            address.setText(network.url);
            address.setTextColor(getColor(R.color.text_muted));
            address.setTextSize(12);

            TextView status = new TextView(this);
            status.setText(R.string.network_page_checking);
            status.setTextColor(getColor(R.color.text_secondary));
            status.setTextSize(12);
            status.setPadding(0, dp(6), 0, 0);

            content.addView(title);
            content.addView(address);
            content.addView(status);
            content.setOnClickListener(v -> switchNetwork(network));

            TextView remove = new TextView(this);
            remove.setText(R.string.network_remove_button);
            remove.setTextColor(getColor(R.color.danger));
            remove.setTextSize(13);
            remove.setPadding(dp(12), dp(8), dp(10), dp(8));
            remove.setOnClickListener(v -> confirmRemoveNetwork(network));

            row.addView(content);
            row.addView(remove);
            networkList.addView(row);
            statusViews.put(network.url, status);
        }

        // 后台逐个探测 /health，把「可连接 · 测试环境 / 线上 / 连不上」写回对应行。
        executor.execute(() -> {
            for (SavedNetwork network : networks) {
                HealthProbe probe = probeHealth(network.url);
                mainHandler.post(() -> {
                    TextView status = statusViews.get(network.url);
                    if (status == null) return;
                    if (!probe.reachable) {
                        status.setText(R.string.network_page_fail);
                        status.setTextColor(getColor(R.color.danger));
                        return;
                    }
                    if ("test".equals(probe.environment)) {
                        status.setText(getString(R.string.network_page_ok_test, probe.latencyMs));
                        status.setTextColor(getColor(R.color.env_test));
                    } else if ("production".equals(probe.environment)) {
                        status.setText(getString(R.string.network_page_ok_production, probe.latencyMs));
                        status.setTextColor(getColor(R.color.success));
                    } else {
                        status.setText(getString(R.string.network_page_ok, probe.latencyMs));
                        status.setTextColor(getColor(R.color.success));
                    }
                });
            }
        });
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private void switchNetwork(SavedNetwork network) {
        preferences().edit().putString(KEY_SERVER_URL, network.url).apply();
        Toast.makeText(this, getString(R.string.network_switched, network.label), Toast.LENGTH_SHORT).show();
        loadServer(network.url);
    }

    /** 删除确认：删当前正在用的那条要先说清之后会连哪儿，别让人以为会被踢到空白页。 */
    private void confirmRemoveNetwork(SavedNetwork network) {
        boolean isActive = network.url.equals(preferences().getString(KEY_SERVER_URL, ""));
        String message = isActive
                ? getString(R.string.network_remove_active_confirm, network.label)
                : getString(R.string.network_remove_confirm, network.label, network.url);
        new AlertDialog.Builder(this)
                .setTitle(R.string.network_remove_title)
                .setMessage(message)
                .setNegativeButton(R.string.dialog_cancel, null)
                .setPositiveButton(R.string.dialog_delete, (dialog, which) -> removeNetwork(network.url))
                .show();
    }

    /** 删除一条已保存的网络。删的是当前地址时切到剩下第一条，一条不剩就回到「添加地址」页。 */
    private void removeNetwork(String rawUrl) {
        List<SavedNetwork> networks = loadNetworks();
        SavedNetwork removed = null;
        for (int index = 0; index < networks.size(); index += 1) {
            if (networks.get(index).url.equals(rawUrl)) {
                removed = networks.remove(index);
                break;
            }
        }
        if (removed == null) return;
        persistNetworks(networks);
        Toast.makeText(this, getString(R.string.network_removed, removed.label), Toast.LENGTH_SHORT).show();

        boolean wasActive = removed.url.equals(preferences().getString(KEY_SERVER_URL, ""));
        if (!wasActive) {
            renderNetworkList();
            return;
        }
        String nextUrl = networks.isEmpty() ? "" : networks.get(0).url;
        preferences().edit().putString(KEY_SERVER_URL, nextUrl).apply();
        if (TextUtils.isEmpty(nextUrl)) {
            openSetupView();
        } else {
            loadServer(nextUrl);
        }
    }

    /** 解析扫码结果：既支持普通地址，也支持带 label 的多地址 JSON（电脑端二维码）。 */
    private List<SavedNetwork> parseScanContent(String content) {
        List<SavedNetwork> result = new ArrayList<>();
        String trimmed = content == null ? "" : content.trim();
        if (trimmed.startsWith("{")) {
            try {
                JSONArray array = new JSONObject(trimmed).optJSONArray("addresses");
                if (array != null) {
                    for (int index = 0; index < array.length(); index += 1) {
                        JSONObject item = array.optJSONObject(index);
                        if (item == null) continue;
                        String url = normalizeUrl(item.optString("url", ""));
                        if (url != null) result.add(new SavedNetwork(item.optString("label", labelFor(url)), url));
                    }
                }
            } catch (JSONException ignored) {
            }
            return result;
        }
        String url = normalizeUrl(trimmed);
        if (url != null) result.add(new SavedNetwork(labelFor(url), url));
        return result;
    }

    private void showView(View target) {
        browserView.setVisibility(target == browserView ? View.VISIBLE : View.GONE);
        setupView.setVisibility(target == setupView ? View.VISIBLE : View.GONE);
        networkView.setVisibility(target == networkView ? View.VISIBLE : View.GONE);
    }

    private void showTestResult(int textRes, int colorRes) {
        if (textRes < 0) {
            testResult.setVisibility(View.GONE);
            return;
        }
        testResult.setVisibility(View.VISIBLE);
        testResult.setText(textRes);
        testResult.setTextColor(getColor(colorRes));
    }

    private void showTestResultText(String text, int colorRes) {
        testResult.setVisibility(View.VISIBLE);
        testResult.setText(text);
        testResult.setTextColor(getColor(colorRes));
    }

    /** 补全协议头并去掉末尾斜杠；仅允许 http/https，拒绝手机本机回环地址。 */
    private String normalizeUrl(String raw) {
        String value = raw == null ? "" : raw.trim();
        if (value.isEmpty()) return null;
        String lower = value.toLowerCase();
        int schemeEnd = lower.indexOf("://");
        if (schemeEnd > 0 && !lower.startsWith("http://") && !lower.startsWith("https://")) {
            return null; // 只接受 http/https，拒绝其他协议的二维码内容
        }
        if (schemeEnd < 0) {
            value = "http://" + value;
        }
        while (value.endsWith("/")) {
            value = value.substring(0, value.length() - 1);
        }
        Uri uri = Uri.parse(value);
        String host = uri.getHost();
        if (TextUtils.isEmpty(host)) return null;
        // 工作台服务器不可能在手机本机；环回地址一律视为无效。
        if (host.equalsIgnoreCase("localhost") || host.equals("::1") || host.startsWith("127.")) {
            return null;
        }
        return value;
    }

    /** 在后台线程访问 /health 判断服务器是否可达。 */
    private boolean isReachable(String baseUrl) {
        return probeHealth(baseUrl).reachable;
    }

    /** /health 探测结果：能否连通、往返耗时，以及该实例是测试端还是线上（老版本服务端没有该字段时为 null）。 */
    private static final class HealthProbe {
        final boolean reachable;
        final String environment;
        final long latencyMs;

        HealthProbe(boolean reachable, String environment, long latencyMs) {
            this.reachable = reachable;
            this.environment = environment;
            this.latencyMs = latencyMs;
        }
    }

    /**
     * 读 /health：既判断可达性，也读出环境标识与延迟。
     * 本机测试实例和线上在列表里长得一模一样，只有环境字段能让人当场分辨；
     * 而"能不能连"用户一眼就能从延迟数字上看出来，所以列表直接报毫秒数。
     */
    private HealthProbe probeHealth(String baseUrl) {
        long startedAt = System.nanoTime();
        try {
            HttpURLConnection connection = (HttpURLConnection) new URL(baseUrl + "/health").openConnection();
            connection.setConnectTimeout(5000);
            connection.setReadTimeout(5000);
            connection.setRequestMethod("GET");
            int code = connection.getResponseCode();
            InputStream stream = code >= 400 ? connection.getErrorStream() : connection.getInputStream();
            String body = stream == null ? "" : new String(readAllBytes(stream), "UTF-8");
            if (stream != null) {
                stream.close();
            }
            connection.disconnect();
            long latencyMs = Math.max(1, Math.round((System.nanoTime() - startedAt) / 1_000_000.0));
            if (code < 200 || code >= 500) return new HealthProbe(false, null, 0); // 4xx 说明服务在，只是健康检查路径受保护
            String environment = null;
            try {
                JSONObject data = new JSONObject(body).optJSONObject("data");
                if (data != null) {
                    String value = data.optString("environment", "");
                    if (!TextUtils.isEmpty(value)) environment = value;
                }
            } catch (JSONException ignored) {
                // 旧版本服务端没有 environment 字段，按未知处理
            }
            return new HealthProbe(true, environment, latencyMs);
        } catch (Exception e) {
            return new HealthProbe(false, null, 0);
        }
    }

    // ===== 保存图片到系统相册 =====

    /**
     * 把图片下载下来写进系统相册。
     * 系统下载器那条路只把文件丢进「下载」目录，用户在相册里翻不到；而且网页里
     * blob + a[download] 在 WebView 中会被静默忽略，所以图片必须由原生落盘到相册。
     */
    private void saveImageToGallery(String rawUrl, String rawName) {
        String url = absoluteImageUrl(rawUrl);
        if (url == null) {
            notifyImageSaved(false);
            return;
        }
        // Android 10 起往公共媒体库写文件不再需要权限；更早的版本必须先拿到存储权限。
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q
                && checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
            pendingImageUrl = url;
            pendingImageName = rawName;
            requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, STORAGE_PERMISSION_REQUEST);
            return;
        }

        String fileName = imageFileName(url, rawName);
        Toast.makeText(this, R.string.save_image_started, Toast.LENGTH_SHORT).show();
        executor.execute(() -> {
            boolean saved = false;
            try {
                byte[] data = downloadBytes(url);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    writeImageToMediaStore(fileName, data);
                } else {
                    writeImageToLegacyPictures(fileName, data);
                }
                saved = true;
            } catch (Exception ignored) {
                // 具体原因对用户没有意义，统一提示重试即可。
            }
            boolean result = saved;
            mainHandler.post(() -> notifyImageSaved(result));
        });
    }

    /** 保存结束：提示用户，并通知网页把按钮从「保存中」恢复过来。 */
    private void notifyImageSaved(boolean ok) {
        Toast.makeText(this, ok ? R.string.save_image_done : R.string.save_image_failed, Toast.LENGTH_SHORT).show();
        if (webView == null) return;
        webView.evaluateJavascript(
                "window.__workbenchImageSaved&&window.__workbenchImageSaved(" + ok + ");", null);
    }

    /** 补全绝对地址：网页里传过来的往往是 /files/... 这类相对路径。 */
    private String absoluteImageUrl(String raw) {
        String value = raw == null ? "" : raw.trim();
        if (value.isEmpty()) return null;
        if (value.startsWith("//")) value = "http:" + value;
        if (value.contains("://")) return value;
        String base = webView == null ? null : webView.getUrl();
        if (base == null) return null;
        try {
            return new URL(new URL(base), value).toString();
        } catch (Exception error) {
            return null;
        }
    }

    /** 文件名优先用网页给的产品图片名，没有就从地址里猜一个，并保证带图片后缀。 */
    private String imageFileName(String url, String rawName) {
        String name = rawName == null ? "" : rawName.trim().replaceAll("[\\\\/:*?\"<>|]+", "_");
        if (TextUtils.isEmpty(name)) name = android.webkit.URLUtil.guessFileName(url, null, null);
        if (TextUtils.isEmpty(name) || name.startsWith("downloadfile")) {
            name = "workbench-" + System.currentTimeMillis() + ".jpg";
        }
        return IMAGE_URL_PATTERN.matcher(name).find() ? name : name + ".jpg";
    }

    private String mimeTypeOf(String fileName) {
        String lower = fileName.toLowerCase();
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".webp")) return "image/webp";
        if (lower.endsWith(".gif")) return "image/gif";
        if (lower.endsWith(".bmp")) return "image/bmp";
        return "image/jpeg";
    }

    /** 带上 WebView 的登录 Cookie 取回图片字节：图片接口需要登录态。 */
    private byte[] downloadBytes(String url) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        try {
            connection.setConnectTimeout(10_000);
            connection.setReadTimeout(20_000);
            String cookie = CookieManager.getInstance().getCookie(url);
            if (cookie != null) connection.setRequestProperty("Cookie", cookie);
            int code = connection.getResponseCode();
            if (code < 200 || code >= 300) throw new IOException("HTTP " + code);
            try (InputStream input = connection.getInputStream()) {
                return readAllBytes(input);
            }
        } finally {
            connection.disconnect();
        }
    }

    /** Android 10 及以上：通过 MediaStore 写进相册（Pictures/个人工作台），无需存储权限。 */
    private void writeImageToMediaStore(String fileName, byte[] data) throws IOException {
        ContentValues values = new ContentValues();
        values.put(MediaStore.Images.Media.DISPLAY_NAME, fileName);
        values.put(MediaStore.Images.Media.MIME_TYPE, mimeTypeOf(fileName));
        values.put(MediaStore.Images.Media.RELATIVE_PATH,
                Environment.DIRECTORY_PICTURES + "/" + GALLERY_FOLDER);
        values.put(MediaStore.Images.Media.IS_PENDING, 1);
        Uri target = getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
        if (target == null) throw new IOException("media store insert failed");
        try {
            try (OutputStream output = getContentResolver().openOutputStream(target)) {
                if (output == null) throw new IOException("media store open failed");
                output.write(data);
            }
            ContentValues ready = new ContentValues();
            ready.put(MediaStore.Images.Media.IS_PENDING, 0);
            getContentResolver().update(target, ready, null, null);
        } catch (IOException error) {
            getContentResolver().delete(target, null, null); // 写失败别在相册里留半张坏图
            throw error;
        }
    }

    /** Android 9 及以下：直接写 Pictures 目录，再通知相册扫描出来。 */
    private void writeImageToLegacyPictures(String fileName, byte[] data) throws IOException {
        File folder = new File(
                Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES), GALLERY_FOLDER);
        if (!folder.exists() && !folder.mkdirs()) throw new IOException("mkdir failed");
        File file = new File(folder, fileName);
        try (OutputStream output = new FileOutputStream(file)) {
            output.write(data);
        }
        MediaScannerConnection.scanFile(
                this, new String[]{file.getAbsolutePath()}, new String[]{mimeTypeOf(fileName)}, null);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        if (requestCode == STORAGE_PERMISSION_REQUEST) {
            String url = pendingImageUrl;
            String name = pendingImageName;
            pendingImageUrl = null;
            pendingImageName = null;
            if (url != null && grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                saveImageToGallery(url, name);
            } else {
                // 用户拒绝也要回执，否则网页那边会一直停在「保存中」。
                notifyImageSaved(false);
            }
            return;
        }
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_CHOOSER_REQUEST) {
            // 无论成功、取消还是解析异常都必须给 WebView 回执，否则文件框会卡死，后续点击全无反应。
            Uri[] result = null;
            if (resultCode == RESULT_OK) {
                try {
                    result = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
                } catch (Exception ignored) {
                }
            }
            if (fileCallback != null) {
                fileCallback.onReceiveValue(result);
                fileCallback = null;
            }
            return;
        }
        if (requestCode == PICK_FILES_REQUEST) {
            handlePickedFiles(resultCode, data);
            return;
        }
        // 扫码结果：支持单地址与「局域网 + 隧道」多地址两种二维码。
        IntentResult scanResult = IntentIntegrator.parseActivityResult(requestCode, resultCode, data);
        if (scanResult != null) {
            String content = scanResult.getContents();
            if (content == null) return; // 用户取消扫码
            List<SavedNetwork> scanned = parseScanContent(content);
            if (scanned.isEmpty()) {
                showTestResultText(getString(R.string.scan_invalid), R.color.danger);
                return;
            }
            // 倒序写入，让二维码里的第一条（通常是局域网）成为当前使用地址。
            for (int index = scanned.size() - 1; index >= 0; index -= 1) {
                SavedNetwork network = scanned.get(index);
                rememberNetwork(network.label, network.url);
            }
            String primary = scanned.get(0).url;
            urlInput.setText(primary);
            if (scanned.size() > 1) {
                Toast.makeText(this, "已保存 " + scanned.size() + " 条网络，可随时切换", Toast.LENGTH_SHORT).show();
            }
            runConnectionTest(primary);
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onBackPressed() {
        if (browserView.getVisibility() == View.VISIBLE && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        moveTaskToBack(true);
    }

    @Override
    protected void onDestroy() {
        executor.shutdown();
        super.onDestroy();
    }
}
