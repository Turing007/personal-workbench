package com.workbench.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.text.TextUtils;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
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

/**
 * 个人工作台安卓壳：全屏 WebView 加载工作台服务。
 * 首次启动填写服务器地址，之后自动进入；断线显示重试页；支持上传选图与文件下载。
 */
public class MainActivity extends Activity {

    private static final String PREFS = "workbench";
    private static final String KEY_SERVER_URL = "server_url";
    private static final int FILE_CHOOSER_REQUEST = 1001;

    private WebView webView;
    private SwipeRefreshLayout swipeRefresh;
    private ProgressBar loadProgress;
    private View browserView;
    private View setupView;
    private View errorView;
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
        errorView = findViewById(R.id.error_view);
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

    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setMediaPlaybackRequiresUserGesture(true);
        webView.setBackgroundColor(Color.TRANSPARENT);

        swipeRefresh.setColorSchemeColors(getColor(R.color.brand_teal));
        // 页面自身使用内部滚动容器，WebView 会认为自己“不能滚动”，导致每次下滑都被
        // 下拉刷新拦截（既触发刷新又吃掉滚动手势）。这里禁用下拉刷新，刷新交给页面内操作。
        swipeRefresh.setEnabled(false);

        webView.setWebViewClient(new WebViewClient() {
            @Override
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
                if (errorView.getVisibility() != View.VISIBLE) {
                    showView(browserView);
                }
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    showView(errorView);
                }
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
            preferences().edit().putString(KEY_SERVER_URL, url).apply();
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
        findViewById(R.id.retry_button).setOnClickListener(v -> {
            showView(browserView);
            swipeRefresh.setRefreshing(true);
            webView.reload();
        });
        findViewById(R.id.change_address_button).setOnClickListener(v -> {
            String current = preferences().getString(KEY_SERVER_URL, "");
            urlInput.setText(current);
            showView(setupView);
        });
    }

    private void loadServer(String url) {
        showView(browserView);
        webView.loadUrl(url);
    }

    private void showView(View target) {
        browserView.setVisibility(target == browserView ? View.VISIBLE : View.GONE);
        setupView.setVisibility(target == setupView ? View.VISIBLE : View.GONE);
        errorView.setVisibility(target == errorView ? View.VISIBLE : View.GONE);
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
            return code >= 200 && code < 500; // 4xx 说明服务在，只是健康检查路径受保护
        } catch (Exception e) {
            return false;
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_CHOOSER_REQUEST && fileCallback != null) {
            fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            fileCallback = null;
            return;
        }
        // 扫码结果：填入地址输入框并自动测试连接。
        IntentResult scanResult = IntentIntegrator.parseActivityResult(requestCode, resultCode, data);
        if (scanResult != null) {
            String content = scanResult.getContents();
            if (content == null) return; // 用户取消扫码
            String url = normalizeUrl(content);
            if (url == null) {
                showTestResultText(getString(R.string.scan_invalid), R.color.danger);
                return;
            }
            urlInput.setText(url);
            runConnectionTest(url);
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
