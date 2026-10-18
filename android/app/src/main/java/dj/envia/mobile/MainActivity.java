package dj.envia.mobile;
import android.Manifest;
import android.app.Activity;
import android.os.Bundle;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.provider.MediaStore;
import android.content.ContentValues;
import android.net.Uri;
import android.webkit.*;
import android.widget.*;
import android.view.View;
import android.view.ViewGroup;
import android.graphics.Color;

public class MainActivity extends Activity {
  private WebView web;
  private ValueCallback<Uri[]> fileCallback;
  private Uri cameraImageUri;
  private static final int PICK_FILE = 51;
  private static final int LOCATION_REQ = 52;
  private GeolocationPermissions.Callback locationCallback;
  private String locationOrigin;
  @Override public void onCreate(Bundle state) {
    super.onCreate(state);
    web = new WebView(this);
    web.setBackgroundColor(Color.WHITE);
    setContentView(web, new ViewGroup.LayoutParams(-1,-1));
    WebSettings s = web.getSettings();
    s.setJavaScriptEnabled(true); s.setDomStorageEnabled(true);
    s.setDatabaseEnabled(true); s.setMediaPlaybackRequiresUserGesture(true);
    s.setGeolocationEnabled(true); s.setAllowFileAccess(false);
    web.setWebViewClient(new WebViewClient() {
      @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
        Uri uri = req.getUrl();
        if ("envia-mobile.onrender.com".equals(uri.getHost()) && "https".equals(uri.getScheme())) return false;
        try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); } catch (Exception ignored) { }
        return true;
      }
    });
    web.setWebChromeClient(new WebChromeClient() {
      @Override public boolean onShowFileChooser(WebView w, ValueCallback<Uri[]> cb, FileChooserParams params) {
        if (fileCallback != null) fileCallback.onReceiveValue(null);
        fileCallback=cb;
        try {
          Intent gallery = new Intent(Intent.ACTION_GET_CONTENT);
          gallery.setType("image/*");
          gallery.addCategory(Intent.CATEGORY_OPENABLE);
          Intent camera = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
          ContentValues values = new ContentValues();
          values.put(MediaStore.Images.Media.DISPLAY_NAME, "ENVIA_" + System.currentTimeMillis() + ".jpg");
          values.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
          cameraImageUri = getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
          if (cameraImageUri != null) camera.putExtra(MediaStore.EXTRA_OUTPUT, cameraImageUri);
          Intent chooser = Intent.createChooser(gallery, "Ajouter une photo ENVIA");
          if (cameraImageUri != null && camera.resolveActivity(getPackageManager()) != null)
            chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[]{camera});
          startActivityForResult(chooser, PICK_FILE);
        }
        catch(Exception ex) { fileCallback=null; cb.onReceiveValue(null); if(cameraImageUri!=null) getContentResolver().delete(cameraImageUri,null,null); cameraImageUri=null; return false; }
        return true;
      }
      @Override public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback cb) {
        if (!"https://envia-mobile.onrender.com".equals(origin)) { cb.invoke(origin,false,false); return; }
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED) cb.invoke(origin,true,false);
        else { locationOrigin=origin; locationCallback=cb; requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION,Manifest.permission.ACCESS_COARSE_LOCATION},LOCATION_REQ); }
      }
    });
    web.loadUrl("https://envia-mobile.onrender.com/mobile/");
  }
  @Override public void onRequestPermissionsResult(int code,String[] perms,int[] results) {
    super.onRequestPermissionsResult(code,perms,results);
    if (code==LOCATION_REQ && locationCallback!=null) { boolean ok=results.length>0 && results[0]==PackageManager.PERMISSION_GRANTED; locationCallback.invoke(locationOrigin,ok,false); locationCallback=null; }
  }
  @Override protected void onActivityResult(int request,int result,Intent data) {
    super.onActivityResult(request,result,data);
    if(request==PICK_FILE && fileCallback!=null) {
      Uri[] chosen = null;
      if(result == RESULT_OK) {
        if(data != null && data.getData()!=null) chosen = new Uri[]{data.getData()};
        else if(cameraImageUri != null) chosen = new Uri[]{cameraImageUri};
      }
      if((chosen == null || cameraImageUri != chosen[0]) && cameraImageUri != null)
        getContentResolver().delete(cameraImageUri,null,null);
      fileCallback.onReceiveValue(chosen);
      fileCallback=null;
      cameraImageUri=null;
    }
  }
  @Override public void onBackPressed() { if(web.canGoBack()) web.goBack(); else super.onBackPressed(); }
}
