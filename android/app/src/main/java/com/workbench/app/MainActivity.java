package com.workbench.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.text.TextUtils;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
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

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

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

    private WebView webView;
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
        // 从桌面快捷方式「选择网络」进入时，直接打开网络选择页。
        handleShortcutIntent();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleShortcutIntent();
    }

    private void handleShortcutIntent() {
        Intent intent = getIntent();
        if (intent != null && "com.workbench.app.SELECT_NETWORK".equals(intent.getAction())) {
            showNetworkPage();
        }
    }

    private SharedPreferences preferences() {
        return getSharedPreferences(PREFS, MODE_PRIVATE);
    }

    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setMediaPlaybackRequiresUserGesture(true);
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

            // 隧道/代理在「后端不可达」时会返回 502/504 这类错误页：WebView 认为加载成功，
            // 不触发 onReceivedError。这里同样进入选择网络页，避免用户卡在错误页上。
            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (!request.isForMainFrame()) return;
                if (response.getStatusCode() >= 400) showNetworkPage();
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
                if (fileCallback != null) {
                    fileCallback.onReceiveValue(null);
                }
                fileCallback = callback;
                try {
                    startActivityForResult(params.createIntent(), FILE_CHOOSER_REQUEST);
                } catch (Exception e) {
                    fileCallback = null;
                    return false;
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
            boolean ok = isReachable(url);
            mainHandler.post(() -> {
                testButton.setEnabled(true);
                showTestResult(ok ? R.string.test_ok : R.string.test_fail,
                        ok ? R.color.success : R.color.danger);
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
            LinearLayout row = new LinearLayout(this);
            row.setOrientation(LinearLayout.VERTICAL);
            row.setPadding(dp(14), dp(12), dp(14), dp(12));
            LinearLayout.LayoutParams rowParams = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            rowParams.bottomMargin = dp(8);
            row.setLayoutParams(rowParams);
            row.setBackgroundResource(R.drawable.input_bg);

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

            row.addView(title);
            row.addView(address);
            row.addView(status);
            row.setOnClickListener(v -> switchNetwork(network));
            networkList.addView(row);
            statusViews.put(network.url, status);
        }

        // 后台逐个探测 /health，把「可连接（含耗时）/ 连不上」写回对应行。
        executor.execute(() -> {
            for (SavedNetwork network : networks) {
                ProbeResult result = probe(network.url);
                mainHandler.post(() -> {
                    TextView status = statusViews.get(network.url);
                    if (status == null) return;
                    if (!result.reachable) {
                        status.setText(R.string.network_page_fail);
                        status.setTextColor(getColor(R.color.danger));
                        return;
                    }
                    // 超过 1 秒的线路标成「较慢」，方便在局域网与隧道之间做选择。
                    boolean slow = result.millis >= 1000;
                    status.setText(getString(
                            slow ? R.string.network_page_ok_slow : R.string.network_page_ok,
                            result.millis));
                    status.setTextColor(getColor(slow ? R.color.warning : R.color.success));
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
        return probe(baseUrl).reachable;
    }

    /** 探测结果：是否可用 + 往返耗时（用于展示线路快慢）。 */
    private static final class ProbeResult {
        final boolean reachable;
        final long millis;

        ProbeResult(boolean reachable, long millis) {
            this.reachable = reachable;
            this.millis = millis;
        }
    }

    private ProbeResult probe(String baseUrl) {
        long started = System.currentTimeMillis();
        try {
            HttpURLConnection connection = (HttpURLConnection) new URL(baseUrl + "/health").openConnection();
            connection.setConnectTimeout(5000);
            connection.setReadTimeout(5000);
            connection.setRequestMethod("GET");
            int code = connection.getResponseCode();
            InputStream stream = code >= 400 ? connection.getErrorStream() : connection.getInputStream();
            if (stream != null) {
                stream.close();
            }
            connection.disconnect();
            // 4xx 说明服务在（只是该路径受保护）；5xx（含隧道 502）视为不可用。
            return new ProbeResult(code >= 200 && code < 500, System.currentTimeMillis() - started);
        } catch (Exception e) {
            return new ProbeResult(false, System.currentTimeMillis() - started);
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_CHOOSER_REQUEST && fileCallback != null) {
            fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            fileCallback = null;
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
