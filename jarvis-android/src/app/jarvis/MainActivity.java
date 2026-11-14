package app.jarvis;

import android.Manifest;
import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.ImageDecoder;
import android.graphics.pdf.PdfRenderer;
import android.media.MediaPlayer;
import android.net.Uri;
import android.os.Bundle;
import android.os.ParcelFileDescriptor;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.util.Base64;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONArray;
import org.json.JSONObject;

// Casca do Jarvis: a tela é assets/app.html; aqui fica o que só o Android faz
// (Compartilhar, reduzir fotos, falar com o servidor guardando o token, mostrar o PDF e o Habblaud).
public class MainActivity extends Activity {
    static final String SERVIDOR = "https://servidor.tail1458e4.ts.net:8095";
    static final String ESCRITORIO = "https://servidor.tail1458e4.ts.net:4747";
    static final String SEM_REDE = "Não consegui falar com o servidor. O Tailscale do celular está ligado?";
    static final int ESCOLHER = 1;
    static final int LADO_MAX = 2000;

    WebView ui, office;
    SharedPreferences prefs;
    final ArrayList<Uri> fotos = new ArrayList<>();
    final ExecutorService bg = Executors.newSingleThreadExecutor();

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().setStatusBarColor(Color.parseColor("#111315"));
        getWindow().setNavigationBarColor(Color.parseColor("#17191c"));
        prefs = getSharedPreferences("jarvis", MODE_PRIVATE);
        ui = new WebView(this);
        ui.setBackgroundColor(Color.parseColor("#111315")); // sem clarão branco ao abrir
        WebSettings s = ui.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        ui.addJavascriptInterface(this, "Jarvis");
        office = new WebView(this);
        WebSettings o = office.getSettings();
        o.setJavaScriptEnabled(true);
        o.setDomStorageEnabled(true);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(office, true);
        office.setWebViewClient(new WebViewClient()); // navegação do Habblaud fica dentro do app
        setContentView(ui);
        receber(getIntent());
        ui.loadUrl("file:///android_asset/app.html");
    }

    @Override protected void onNewIntent(Intent i) {
        super.onNewIntent(i);
        receber(i);
        setContentView(ui);
        js("window.onFotos && onFotos()");
    }

    @Override protected void onPause() { super.onPause(); CookieManager.getInstance().flush(); }

    @Override public void onBackPressed() {
        if (office.getParent() != null) { setContentView(ui); js("window.onVoltou && onVoltou()"); }
        // Fora de Pedidos, o voltar leva para Pedidos; em Pedidos, sai do app.
        else ui.evaluateJavascript("window.voltar ? voltar() : false", v -> { if (!"true".equals(v)) super.onBackPressed(); });
    }

    // ---- fotos recebidas pelo Compartilhar ou escolhidas na galeria ----
    void receber(Intent i) {
        if (i == null) return;
        String a = i.getAction();
        if (Intent.ACTION_SEND.equals(a)) {
            Uri u = i.getParcelableExtra(Intent.EXTRA_STREAM); // versão sem classe: a com classe só existe do Android 13 em diante
            if (u != null) { fotos.clear(); fotos.add(u); }
        } else if (Intent.ACTION_SEND_MULTIPLE.equals(a)) {
            ArrayList<Uri> us = i.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (us != null) { fotos.clear(); fotos.addAll(us); }
        }
    }

    @Override protected void onActivityResult(int req, int res, Intent data) {
        if (req != ESCOLHER || res != RESULT_OK || data == null) return;
        ClipData clip = data.getClipData();
        if (clip != null) for (int k = 0; k < clip.getItemCount(); k++) fotos.add(clip.getItemAt(k).getUri());
        else if (data.getData() != null) fotos.add(data.getData());
        js("window.onFotos && onFotos()");
    }

    // Reduz para no máximo 2000 px no lado maior e converte para JPEG 85 (HEIC e WebP também).
    byte[] jpeg(Uri u, int lado) throws Exception {
        Bitmap bmp = ImageDecoder.decodeBitmap(ImageDecoder.createSource(getContentResolver(), u), (dec, info, src) -> {
            int w = info.getSize().getWidth(), h = info.getSize().getHeight();
            float k = Math.min(1f, (float) lado / Math.max(w, h));
            dec.setTargetSize(Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k)));
            dec.setAllocator(ImageDecoder.ALLOCATOR_SOFTWARE);
        });
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        bmp.compress(Bitmap.CompressFormat.JPEG, 85, out);
        bmp.recycle();
        return out.toByteArray();
    }

    // ---- HTTP com o token (a página nunca vê o token) ----
    JSONObject http(String method, String path, String type, byte[] body) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(prefs.getString("servidor", SERVIDOR) + path).openConnection();
        c.setRequestMethod(method);
        c.setConnectTimeout(15000);
        c.setReadTimeout(60000);
        c.setRequestProperty("Authorization", "Bearer " + prefs.getString("token", ""));
        if (body != null) {
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", type);
            c.setFixedLengthStreamingMode(body.length);
            try (OutputStream o = c.getOutputStream()) { o.write(body); }
        }
        int status = c.getResponseCode();
        InputStream in = status < 400 ? c.getInputStream() : c.getErrorStream();
        String text = in == null ? "" : new String(ler(in), "UTF-8");
        JSONObject r = new JSONObject().put("status", status);
        if (!text.isEmpty()) r.put("body", new JSONObject(text));
        return r;
    }

    static byte[] ler(InputStream in) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[16384];
        for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
        in.close();
        return out.toByteArray();
    }

    void js(String code) { runOnUiThread(() -> ui.evaluateJavascript(code, null)); }

    void responder(String cb, boolean ok, Object dado) {
        js("window.__cb(" + JSONObject.quote(cb) + "," + ok + "," + JSONObject.quote(String.valueOf(dado)) + ")");
    }

    String erro(Exception e) { return e instanceof java.io.IOException ? SEM_REDE : String.valueOf(e.getMessage()); }

    // ---- chamadas da página ----
    @JavascriptInterface public String config() {
        try {
            return new JSONObject().put("servidor", prefs.getString("servidor", SERVIDOR)).put("temToken", !prefs.getString("token", "").isEmpty()).toString();
        } catch (Exception e) { return "{}"; }
    }

    @JavascriptInterface public void salvarConfig(String servidor, String token) {
        SharedPreferences.Editor e = prefs.edit().putString("servidor", servidor.trim().replaceAll("/+$", ""));
        if (!token.trim().isEmpty()) e.putString("token", token.trim());
        e.apply();
    }

    @JavascriptInterface public int quantasFotos() { return fotos.size(); }

    @JavascriptInterface public void limparFotos() { fotos.clear(); }

    @JavascriptInterface public void tirarFoto(int i) { if (i >= 0 && i < fotos.size()) fotos.remove(i); }

    @JavascriptInterface public void escolherFotos() {
        Intent i = new Intent(Intent.ACTION_GET_CONTENT).setType("image/*").putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        runOnUiThread(() -> startActivityForResult(Intent.createChooser(i, "Fotos do negócio"), ESCOLHER));
    }

    @JavascriptInterface public void miniaturas(String cb) {
        bg.execute(() -> {
            JSONArray out = new JSONArray();
            for (Uri u : new ArrayList<>(fotos)) {
                try { out.put("data:image/jpeg;base64," + Base64.encodeToString(jpeg(u, 240), Base64.NO_WRAP)); }
                catch (Exception e) { out.put(""); }
            }
            responder(cb, true, out);
        });
    }

    @JavascriptInterface public void api(String cb, String method, String path, String json) {
        bg.execute(() -> {
            try { responder(cb, true, http(method, path, "application/json", json == null || json.isEmpty() ? null : json.getBytes("UTF-8"))); }
            catch (Exception e) { responder(cb, false, erro(e)); }
        });
    }

    // Cria o pedido, manda as fotos (uma por chamada) e inicia. Progresso: window.onProgresso(n, total).
    @JavascriptInterface public void montar(String cb, String leadId, String observacao) {
        ArrayList<Uri> lista = new ArrayList<>(fotos);
        bg.execute(() -> {
            try {
                JSONObject r = http("POST", "/pedidos", "application/json",
                    new JSONObject().put("leadId", leadId).put("observacao", observacao).toString().getBytes("UTF-8"));
                if (r.getInt("status") != 201) throw new Exception(r.optJSONObject("body") == null ? "Erro " + r.getInt("status") : r.getJSONObject("body").optString("error"));
                String id = r.getJSONObject("body").getString("id");
                for (int k = 0; k < lista.size(); k++) {
                    js("window.onProgresso && onProgresso(" + (k + 1) + "," + lista.size() + ")");
                    JSONObject f = http("POST", "/pedidos/" + id + "/fotos", "image/jpeg", jpeg(lista.get(k), LADO_MAX));
                    if (f.getInt("status") != 201) throw new Exception("Foto " + (k + 1) + ": " + f.optJSONObject("body").optString("error"));
                }
                JSONObject ini = http("POST", "/pedidos/" + id + "/iniciar", null, null);
                if (ini.getInt("status") != 200) throw new Exception(ini.optJSONObject("body").optString("error"));
                fotos.clear();
                responder(cb, true, id);
            } catch (Exception e) { responder(cb, false, erro(e)); }
        });
    }

    // Baixa o PDF e devolve as páginas como imagens (PdfRenderer do Android, sem app externo).
    @JavascriptInterface public void verPrevia(String cb, String id) {
        bg.execute(() -> {
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(prefs.getString("servidor", SERVIDOR) + "/pedidos/" + id + "/previa.pdf").openConnection();
                c.setRequestProperty("Authorization", "Bearer " + prefs.getString("token", ""));
                c.setConnectTimeout(15000);
                c.setReadTimeout(60000);
                if (c.getResponseCode() != 200) throw new Exception("A prévia ainda não está pronta.");
                File f = new File(getCacheDir(), "previa.pdf");
                try (FileOutputStream o = new FileOutputStream(f)) { o.write(ler(c.getInputStream())); }
                JSONArray paginas = new JSONArray();
                try (ParcelFileDescriptor pfd = ParcelFileDescriptor.open(f, ParcelFileDescriptor.MODE_READ_ONLY);
                     PdfRenderer pdf = new PdfRenderer(pfd)) {
                    for (int k = 0; k < pdf.getPageCount(); k++) {
                        try (PdfRenderer.Page p = pdf.openPage(k)) {
                            int w = 1080, h = Math.round(w * (float) p.getHeight() / p.getWidth());
                            Bitmap bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
                            bmp.eraseColor(Color.WHITE);
                            p.render(bmp, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);
                            ByteArrayOutputStream out = new ByteArrayOutputStream();
                            bmp.compress(Bitmap.CompressFormat.JPEG, 85, out);
                            bmp.recycle();
                            paginas.put("data:image/jpeg;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP));
                        }
                    }
                }
                responder(cb, true, paginas);
            } catch (Exception e) { responder(cb, false, erro(e)); }
        });
    }

    @JavascriptInterface public void abrirEscritorio() {
        runOnUiThread(() -> {
            if (office.getUrl() == null) office.loadUrl(ESCRITORIO);
            setContentView(office);
        });
    }

    // ---- Jarvis de voz: ouvir (reconhecimento do Android, pt-BR) e tocar a resposta ----
    static final int MICROFONE = 7;
    SpeechRecognizer escuta;
    String cbOuvir;
    MediaPlayer voz;

    @JavascriptInterface public void ouvir(String cb) {
        runOnUiThread(() -> {
            if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                cbOuvir = cb;
                requestPermissions(new String[] { Manifest.permission.RECORD_AUDIO }, MICROFONE);
                return;
            }
            comecarAOuvir(cb);
        });
    }

    @Override public void onRequestPermissionsResult(int req, String[] perms, int[] res) {
        if (req != MICROFONE || cbOuvir == null) return;
        String cb = cbOuvir;
        cbOuvir = null;
        if (res.length > 0 && res[0] == PackageManager.PERMISSION_GRANTED) comecarAOuvir(cb);
        else responder(cb, false, "Sem permissão do microfone. Libere em Configurações > Apps > Jarvis.");
    }

    void comecarAOuvir(String cb) {
        if (!SpeechRecognizer.isRecognitionAvailable(this)) { responder(cb, false, "Este celular não tem reconhecimento de voz. Digite a pergunta."); return; }
        if (escuta != null) escuta.destroy();
        escuta = SpeechRecognizer.createSpeechRecognizer(this);
        escuta.setRecognitionListener(new RecognitionListener() {
            boolean respondido;
            void fim(boolean ok, String dado) { if (respondido) return; respondido = true; responder(cb, ok, dado); }
            @Override public void onReadyForSpeech(Bundle b) { js("window.onOuvindo && onOuvindo(0)"); }
            @Override public void onBeginningOfSpeech() {}
            @Override public void onRmsChanged(float db) { js("window.onOuvindo && onOuvindo(" + Math.max(0, Math.min(10, db)) + ")"); }
            @Override public void onBufferReceived(byte[] b) {}
            @Override public void onEndOfSpeech() {}
            @Override public void onError(int e) {
                fim(false, e == SpeechRecognizer.ERROR_NO_MATCH || e == SpeechRecognizer.ERROR_SPEECH_TIMEOUT ? "Não entendi, tente de novo."
                    : e == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS ? "Sem permissão do microfone."
                    : e == SpeechRecognizer.ERROR_NETWORK || e == SpeechRecognizer.ERROR_NETWORK_TIMEOUT ? "O reconhecimento de voz precisa de internet."
                    : "Reconhecimento de voz falhou (código " + e + ").");
            }
            @Override public void onResults(Bundle b) {
                ArrayList<String> r = b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                if (r == null || r.isEmpty() || r.get(0).trim().isEmpty()) fim(false, "Não entendi, tente de novo.");
                else fim(true, r.get(0));
            }
            @Override public void onPartialResults(Bundle b) {
                ArrayList<String> r = b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                if (r != null && !r.isEmpty()) js("window.onParcial && onParcial(" + JSONObject.quote(r.get(0)) + ")");
            }
            @Override public void onEvent(int t, Bundle b) {}
        });
        Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE, "pt-BR")
            .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        escuta.startListening(i);
    }

    @JavascriptInterface public void pararDeOuvir() { runOnUiThread(() -> { if (escuta != null) escuta.stopListening(); }); }

    // Baixa o WAV da resposta (com o token) e toca; volta pelo cb quando termina.
    @JavascriptInterface public void tocar(String cb, String id) {
        bg.execute(() -> {
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(prefs.getString("servidor", SERVIDOR) + "/jarvis/mensagens/" + id + "/audio").openConnection();
                c.setRequestProperty("Authorization", "Bearer " + prefs.getString("token", ""));
                c.setConnectTimeout(15000);
                c.setReadTimeout(60000);
                if (c.getResponseCode() != 200) throw new Exception("Sem áudio para esta resposta.");
                File f = new File(getCacheDir(), "jarvis.wav");
                try (FileOutputStream o = new FileOutputStream(f)) { o.write(ler(c.getInputStream())); }
                runOnUiThread(() -> {
                    try {
                        if (voz != null) voz.release();
                        voz = new MediaPlayer();
                        voz.setDataSource(f.getPath());
                        voz.setOnCompletionListener(m -> responder(cb, true, ""));
                        voz.prepare();
                        voz.start();
                    } catch (Exception e) { responder(cb, false, "Não consegui tocar a resposta."); }
                });
            } catch (Exception e) { responder(cb, false, erro(e)); }
        });
    }

    @JavascriptInterface public void pararDeFalar() { runOnUiThread(() -> { if (voz != null && voz.isPlaying()) voz.stop(); }); }
}
