package com.jiaoshi.quiz;

import android.app.Activity;
import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * 应用内更新：查询 GitHub Release -> 比较 -> 下载 -> 拉起安装。
 * 与泡泡课表的 UpdateChecker 同一套方案（零第三方依赖）：
 * HttpsURLConnection 查 API，系统 DownloadManager 下载（自带通知栏进度、断点续传），
 * FileProvider 暴露 APK 给系统安装器。
 *
 * paopao-quiz 本身是公开仓库，检查更新直接指向它自己的 Release，不需要单独的分发仓库。
 * 发布新版本：把「签名后的」APK 传到 Release 里，tag 形如 vX.Y（从 tag 里取数字比较版本），
 * 资产名以 .apk 结尾。绝不往 APK 里嵌 token。
 */
public final class UpdateChecker {

    private UpdateChecker() {}

    private static final String OWNER = "cedarln";

    /** 检查更新查询的仓库（公开仓库，匿名可查） */
    public static final String REPO = "paopao-quiz";

    public static final String API_LATEST =
            "https://api.github.com/repos/" + OWNER + "/" + REPO + "/releases/latest";

    private static final String UPDATE_DIR = "update";

    /** 更新包所在目录（应用专属外部存储 update/） */
    public static File updateDir(Context ctx) {
        return new File(ctx.getExternalFilesDir(null), UPDATE_DIR);
    }

    /**
     * 读取一个已下载 APK 的版本号（解析失败返回空串）。
     * 用于判断「安装包是否已经装完」：包版本 <= 当前安装版本 = 已装完。
     */
    public static String archiveVersion(Context ctx, File apk) {
        try {
            android.content.pm.PackageInfo pi = ctx.getPackageManager()
                    .getPackageArchiveInfo(apk.getAbsolutePath(), 0);
            return pi == null ? "" : pi.versionName;
        } catch (Exception e) {
            return "";
        }
    }

    public static class ReleaseInfo {
        public final String tag;
        public final String apkUrl;
        public final long apkSize;
        public final String notes;

        ReleaseInfo(String tag, String apkUrl, long apkSize, String notes) {
            this.tag = tag;
            this.apkUrl = apkUrl;
            this.apkSize = apkSize;
            this.notes = notes;
        }

        /** "v1.2.3" -> "1.2.3" */
        public String version() {
            return normalizeVersion(tag);
        }
    }

    // ---------- 版本比较（纯逻辑，可单元测试） ----------

    /** 从 tag 里提取版本号：找到第一个数字后只保留数字和点，遇到其他字符就停。 */
    public static String normalizeVersion(String tag) {
        if (tag == null) return "";
        String v = tag.trim();
        int start = -1;
        for (int i = 0; i < v.length(); i++) {
            if (v.charAt(i) >= '0' && v.charAt(i) <= '9') { start = i; break; }
        }
        if (start < 0) return "";
        StringBuilder sb = new StringBuilder();
        boolean lastWasDot = false;
        for (int i = start; i < v.length(); i++) {
            char ch = v.charAt(i);
            if (ch >= '0' && ch <= '9') {
                sb.append(ch);
                lastWasDot = false;
            } else if (ch == '.') {
                if (!lastWasDot) { sb.append('.'); lastWasDot = true; }
            } else {
                break;
            }
        }
        // 去掉首尾的点
        String out = sb.toString();
        while (out.startsWith(".")) out = out.substring(1);
        while (out.endsWith(".")) out = out.substring(0, out.length() - 1);
        return out;
    }

    /** 按数字段比较版本：负数 = a 更旧，0 = 相同，正数 = a 更新 */
    public static int compareVersions(String a, String b) {
        String[] pa = a.split("\\.");
        String[] pb = b.split("\\.");
        int n = Math.max(pa.length, pb.length);
        for (int i = 0; i < n; i++) {
            int x = i < pa.length ? parseIntSafe(pa[i]) : 0;
            int y = i < pb.length ? parseIntSafe(pb[i]) : 0;
            if (x != y) return x - y;
        }
        return 0;
    }

    private static int parseIntSafe(String s) {
        try { return Integer.parseInt(s.trim()); } catch (Exception e) { return 0; }
    }

    /** 最新 Release 的 tag 是否比当前安装的版本新 */
    public static boolean hasNewer(String latestTag, String currentVersion) {
        return currentVersion != null && !currentVersion.isEmpty()
                && compareVersions(normalizeVersion(latestTag), currentVersion) > 0;
    }

    // ---------- GitHub API（阻塞调用，请在子线程执行） ----------

    public static String currentVersion(Context ctx) {
        try {
            return ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0).versionName;
        } catch (Exception e) {
            return "";
        }
    }

    public static ReleaseInfo fetchLatest() throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(API_LATEST).openConnection();
        try {
            conn.setConnectTimeout(10_000);
            conn.setReadTimeout(15_000);
            conn.setRequestProperty("Accept", "application/vnd.github+json");
            int code = conn.getResponseCode();
            if (code != 200) {
                throw new IllegalStateException(
                        code == 404 ? "仓库不可见或还没有 Release" : "HTTP " + code);
            }
            java.io.BufferedReader reader = new java.io.BufferedReader(
                    new java.io.InputStreamReader(conn.getInputStream(), "UTF-8"));
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) sb.append(line);
            reader.close();
            return parseLatest(sb.toString());
        } finally {
            conn.disconnect();
        }
    }

    public static ReleaseInfo parseLatest(String json) throws Exception {
        JSONObject root = new JSONObject(json);
        String tag = root.optString("tag_name", "");
        if (tag.isEmpty()) throw new IllegalStateException("Release 数据里没有 tag_name");
        String url = "";
        long size = 0L;
        JSONArray assets = root.optJSONArray("assets");
        if (assets != null) {
            for (int i = 0; i < assets.length(); i++) {
                JSONObject a = assets.getJSONObject(i);
                if (a.optString("name", "").toLowerCase().endsWith(".apk")) {
                    url = a.optString("browser_download_url", "");
                    size = a.optLong("size", 0);
                    break;
                }
            }
        }
        if (url.isEmpty()) throw new IllegalStateException("最新 Release 里没有 APK 文件");
        return new ReleaseInfo(tag, url, size, root.optString("body", ""));
    }

    // ---------- 下载（系统 DownloadManager，自带通知栏进度） ----------

    /** 下载到应用私有目录 update/ 下，返回下载 id（-1 表示无法入队） */
    public static long download(Context ctx, String url, String fileName) {
        DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url));
        req.setTitle(fileName);
        req.setDescription("泡泡题库 更新包");
        req.setMimeType("application/vnd.android.package-archive");
        req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
        req.setDestinationInExternalFilesDir(ctx, null, UPDATE_DIR + "/" + fileName);
        DownloadManager dm = (DownloadManager) ctx.getSystemService(Context.DOWNLOAD_SERVICE);
        return dm == null ? -1 : dm.enqueue(req);
    }

    public static File downloadedFile(Context ctx, String fileName) {
        return new File(new File(ctx.getExternalFilesDir(null), UPDATE_DIR), fileName);
    }

    public static class DownloadProgress {
        public int status;
        public long downloaded;
        public long total;
    }

    /** 查询下载状态与进度；返回 null 表示查询不到该任务 */
    public static DownloadProgress queryDownload(Context ctx, long id) {
        DownloadManager dm = (DownloadManager) ctx.getSystemService(Context.DOWNLOAD_SERVICE);
        if (dm == null) return null;
        android.database.Cursor cur = dm.query(new DownloadManager.Query().setFilterById(id));
        if (cur == null) return null;
        try {
            if (!cur.moveToFirst()) return null;
            DownloadProgress p = new DownloadProgress();
            int si = cur.getColumnIndex(DownloadManager.COLUMN_STATUS);
            if (si >= 0) p.status = cur.getInt(si);
            int di = cur.getColumnIndex(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR);
            if (di >= 0) p.downloaded = cur.getLong(di);
            int ti = cur.getColumnIndex(DownloadManager.COLUMN_TOTAL_SIZE_BYTES);
            if (ti >= 0) p.total = cur.getLong(ti);
            return p;
        } finally {
            cur.close();
        }
    }

    // ---------- 安装（Android 8+ 需要用户允许「安装未知应用」） ----------

    public static boolean canInstallApk(Context ctx) {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.O
                || ctx.getPackageManager().canRequestPackageInstalls();
    }

    /** 引导用户去开「安装未知应用」权限（回来后重试安装即可） */
    public static void requestInstallPermission(Activity activity) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            activity.startActivity(new Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + activity.getPackageName())));
        }
    }

    /** 拉起系统安装器；权限未开时跳设置页并返回 false */
    public static boolean promptInstall(Activity activity, File apk) {
        if (!canInstallApk(activity)) {
            requestInstallPermission(activity);
            return false;
        }
        Uri uri = FileProvider.getUriForFile(activity,
                activity.getPackageName() + ".fileprovider", apk);
        Intent i = new Intent(Intent.ACTION_VIEW);
        i.setDataAndType(uri, "application/vnd.android.package-archive");
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        activity.startActivity(i);
        return true;
    }
}
