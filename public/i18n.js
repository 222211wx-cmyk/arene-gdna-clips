/* Instant language switch, no reload: every visible string is written in French in the code; this file swaps it for the chosen language
   (text, placeholders, aria-labels, titles), also for content drawn later. A string with no translation stays in French. */
(function () {
  'use strict';
  var LANGS = [['fr', 'Français'], ['ar', 'العربية (الفصحى)'], ['ary', 'الدارجة المغربية'], ['en', 'English'], ['es', 'Español'], ['de', 'Deutsch'], ['it', 'Italiano'], ['pt', 'Português'], ['tr', 'Türkçe'], ['hi', 'हिन्दी'], ['zh', '中文'], ['ja', '日本語'], ['ko', '한국어'], ['ru', 'Русский']];
  var C = ['en', 'es', 'de', 'it', 'pt', 'tr', 'hi', 'zh', 'ja', 'ko', 'ru', 'ar', 'ary'];
  // French -> [en, es, de, it, pt, tr, hi, zh, ja, ko, ru, ar (Fusha), ary (Darija)]
  var D = {
    'Accueil': ['Home', 'Inicio', 'Start', 'Home', 'Início', 'Ana sayfa', 'होम', '首页', 'ホーム', '홈', 'Главная', 'الرئيسية', 'الرئيسية'],
    'Recherche': ['Search', 'Buscar', 'Suche', 'Cerca', 'Buscar', 'Ara', 'खोज', '搜索', '検索', '검색', 'Поиск', 'بحث', 'قلّب'],
    'Clips': ['Clips', 'Clips', 'Clips', 'Clip', 'Clipes', 'Klipler', 'क्लिप्स', '短片', 'クリップ', '클립', 'Клипы', 'المقاطع', 'الكليبات'],
    'Messages': ['Messages', 'Mensajes', 'Nachrichten', 'Messaggi', 'Mensagens', 'Mesajlar', 'संदेश', '消息', 'メッセージ', '메시지', 'Сообщения', 'الرسائل', 'الميساجات'],
    'Profil': ['Profile', 'Perfil', 'Profil', 'Profilo', 'Perfil', 'Profil', 'प्रोफ़ाइल', '我的', 'プロフィール', '프로필', 'Профиль', 'الملف الشخصي', 'البروفيل'],
    'Importer': ['Import', 'Importar', 'Importieren', 'Importa', 'Importar', 'İçe aktar', 'इम्पोर्ट', '导入', 'インポート', '가져오기', 'Импорт', 'استيراد', 'استيراد'],
    'Retour': ['Back', 'Volver', 'Zurück', 'Indietro', 'Voltar', 'Geri', 'वापस', '返回', '戻る', '뒤로', 'Назад', 'رجوع', 'رجوع'],
    'Paramètres': ['Settings', 'Ajustes', 'Einstellungen', 'Impostazioni', 'Configurações', 'Ayarlar', 'सेटिंग्स', '设置', '設定', '설정', 'Настройки', 'الإعدادات', 'الإعدادات'],
    'Langue': ['Language', 'Idioma', 'Sprache', 'Lingua', 'Idioma', 'Dil', 'भाषा', '语言', '言語', '언어', 'Язык', 'اللغة', 'اللغة'],
    'Qualité vidéo': ['Video quality', 'Calidad de vídeo', 'Videoqualität', 'Qualità video', 'Qualidade do vídeo', 'Video kalitesi', 'वीडियो गुणवत्ता', '视频质量', '動画の画質', '영상 화질', 'Качество видео', 'جودة الفيديو', 'جودة الفيديو'],
    'Notifications': ['Notifications', 'Notificaciones', 'Benachrichtigungen', 'Notifiche', 'Notificações', 'Bildirimler', 'सूचनाएँ', '通知', '通知', '알림', 'Уведомления', 'الإشعارات', 'الإشعارات'],
    'Compte': ['Account', 'Cuenta', 'Konto', 'Account', 'Conta', 'Hesap', 'खाता', '账户', 'アカウント', '계정', 'Аккаунт', 'الحساب', 'الحساب'],
    'Confidentialité': ['Privacy', 'Privacidad', 'Datenschutz', 'Privacy', 'Privacidade', 'Gizlilik', 'गोपनीयता', '隐私', 'プライバシー', '개인정보', 'Конфиденциальность', 'الخصوصية', 'الخصوصية'],
    'Thème': ['Theme', 'Tema', 'Design', 'Tema', 'Tema', 'Tema', 'थीम', '主题', 'テーマ', '테마', 'Тема', 'المظهر', 'الثيم'],
    'Aide': ['Help', 'Ayuda', 'Hilfe', 'Aiuto', 'Ajuda', 'Yardım', 'सहायता', '帮助', 'ヘルプ', '도움말', 'Помощь', 'مساعدة', 'مساعدة'],
    'Publier': ['Publish', 'Publicar', 'Veröffentlichen', 'Pubblica', 'Publicar', 'Yayınla', 'प्रकाशित करें', '发布', '投稿する', '게시', 'Опубликовать', 'نشر', 'نشر'],
    'Titre (obligatoire)': ['Title (required)', 'Título (obligatorio)', 'Titel (erforderlich)', 'Titolo (obbligatorio)', 'Título (obrigatório)', 'Başlık (zorunlu)', 'शीर्षक (आवश्यक)', '标题（必填）', 'タイトル（必須）', '제목 (필수)', 'Название (обязательно)', 'العنوان (إلزامي)', 'العنوان (ضروري)'],
    'Description': ['Description', 'Descripción', 'Beschreibung', 'Descrizione', 'Descrição', 'Açıklama', 'विवरण', '描述', '説明', '설명', 'Описание', 'الوصف', 'الوصف'],
    'Hashtags': ['Hashtags', 'Hashtags', 'Hashtags', 'Hashtag', 'Hashtags', 'Etiketler', 'हैशटैग', '话题标签', 'ハッシュタグ', '해시태그', 'Хештеги', 'الوسوم', 'الهاشتاغات'],
    'Commentaire': ['Comment', 'Comentario', 'Kommentar', 'Commento', 'Comentário', 'Yorum', 'टिप्पणी', '评论', 'コメント', '댓글', 'Комментарий', 'تعليق', 'تعليق'],
    'Visibilité': ['Visibility', 'Visibilidad', 'Sichtbarkeit', 'Visibilità', 'Visibilidade', 'Görünürlük', 'दृश्यता', '可见性', '公開範囲', '공개 범위', 'Видимость', 'الظهور', 'من يشوف'],
    'Public': ['Public', 'Público', 'Öffentlich', 'Pubblico', 'Público', 'Herkese açık', 'सार्वजनिक', '公开', '公開', '공개', 'Публичный', 'عام', 'عام'],
    'Luminosité': ['Brightness', 'Brillo', 'Helligkeit', 'Luminosità', 'Brilho', 'Parlaklık', 'चमक', '亮度', '明るさ', '밝기', 'Яркость', 'السطوع', 'الضو'],
    'Contraste': ['Contrast', 'Contraste', 'Kontrast', 'Contrasto', 'Contraste', 'Kontrast', 'कंट्रास्ट', '对比度', 'コントラスト', '대비', 'Контраст', 'التباين', 'التباين'],
    'Saturation': ['Saturation', 'Saturación', 'Sättigung', 'Saturazione', 'Saturação', 'Doygunluk', 'संतृप्ति', '饱和度', '彩度', '채도', 'Насыщенность', 'التشبع', 'التشبع'],
    'Température': ['Temperature', 'Temperatura', 'Temperatur', 'Temperatura', 'Temperatura', 'Sıcaklık', 'तापमान', '色温', '色温度', '색온도', 'Температура', 'درجة اللون', 'حرارة اللون'],
    'Filtres': ['Filters', 'Filtros', 'Filter', 'Filtri', 'Filtros', 'Filtreler', 'फ़िल्टर', '滤镜', 'フィルター', '필터', 'Фильтры', 'الفلاتر', 'الفلاتر'],
    'Couper': ['Cut', 'Cortar', 'Schneiden', 'Taglia', 'Cortar', 'Kes', 'काटें', '剪切', 'カット', '자르기', 'Обрезка', 'قص', 'قطع'],
    'Audio': ['Audio', 'Audio', 'Audio', 'Audio', 'Áudio', 'Ses', 'ऑडियो', '音频', 'オーディオ', '오디오', 'Аудио', 'الصوت', 'الصوت'],
    'Réglages': ['Adjust', 'Ajustes', 'Anpassen', 'Regola', 'Ajustes', 'Ayarla', 'समायोजन', '调整', '調整', '조정', 'Коррекция', 'الضبط', 'التعديل'],
    'Se connecter': ['Log in', 'Iniciar sesión', 'Anmelden', 'Accedi', 'Entrar', 'Giriş yap', 'लॉग इन', '登录', 'ログイン', '로그인', 'Войти', 'تسجيل الدخول', 'دخول'],
    'Déconnexion': ['Log out', 'Cerrar sesión', 'Abmelden', 'Esci', 'Sair', 'Çıkış yap', 'लॉग आउट', '退出登录', 'ログアウト', '로그아웃', 'Выйти', 'تسجيل الخروج', 'خروج'],
    'Musique': ['Music', 'Música', 'Musik', 'Musica', 'Música', 'Müzik', 'संगीत', '音乐', '音楽', '음악', 'Музыка', 'موسيقى', 'موسيقى'],
    'Chansons': ['Songs', 'Canciones', 'Lieder', 'Canzoni', 'Canções', 'Şarkılar', 'गाने', '歌曲', '曲', '노래', 'Песни', 'أغاني', 'الأغاني'],
    'Voix': ['Voice', 'Voz', 'Stimme', 'Voce', 'Voz', 'Ses kaydı', 'आवाज़', '人声', 'ボイス', '음성', 'Голос', 'صوت', 'الصوت ديال الكلام'],
    'Effets': ['Effects', 'Efectos', 'Effekte', 'Effetti', 'Efeitos', 'Efektler', 'इफ़ेक्ट्स', '音效', '効果音', '효과음', 'Эффекты', 'مؤثرات', 'المؤثرات'],
    'Supprimer l’audio original': ['Remove original audio', 'Quitar audio original', 'Originalton entfernen', 'Rimuovi audio originale', 'Remover áudio original', 'Orijinal sesi kaldır', 'मूल ऑडियो हटाएँ', '删除原声', '元の音声を削除', '원본 오디오 삭제', 'Удалить оригинальный звук', 'حذف الصوت الأصلي', 'حيّد الصوت الأصلي'],
    'Aperçu': ['Preview', 'Vista previa', 'Vorschau', 'Anteprima', 'Pré-visualização', 'Önizleme', 'पूर्वावलोकन', '预览', 'プレビュー', '미리보기', 'Предпросмотр', 'معاينة', 'معاينة'],
    'Réinitialiser': ['Reset', 'Restablecer', 'Zurücksetzen', 'Ripristina', 'Redefinir', 'Sıfırla', 'रीसेट', '重置', 'リセット', '초기화', 'Сбросить', 'إعادة ضبط', 'رجّع كيما كان'],
    'Boîte à outils': ['Toolbox', 'Herramientas', 'Werkzeuge', 'Strumenti', 'Ferramentas', 'Araçlar', 'टूलबॉक्स', '工具箱', 'ツール', '도구', 'Инструменты', 'الأدوات', 'الأدوات'],
    'Choisir une vidéo ou une archive': ['Choose a video or archive', 'Elegir un vídeo o archivo', 'Video oder Archiv wählen', 'Scegli un video o archivio', 'Escolher vídeo ou arquivo', 'Video veya arşiv seç', 'वीडियो या आर्काइव चुनें', '选择视频或压缩包', '動画またはアーカイブを選択', '동영상 또는 압축파일 선택', 'Выбрать видео или архив', 'اختر فيديو أو أرشيفًا', 'اختار فيديو ولا أرشيف'],
    'Nouveau clip': ['New clip', 'Nuevo clip', 'Neuer Clip', 'Nuovo clip', 'Novo clipe', 'Yeni klip', 'नई क्लिप', '新短片', '新しいクリップ', '새 클립', 'Новый клип', 'مقطع جديد', 'كليب جديد'],
    'Sombre': ['Dark', 'Oscuro', 'Dunkel', 'Scuro', 'Escuro', 'Koyu', 'डार्क', '深色', 'ダーク', '다크', 'Тёмная', 'داكن', 'غامق'],
    'Clair': ['Light', 'Claro', 'Hell', 'Chiaro', 'Claro', 'Açık', 'लाइट', '浅色', 'ライト', '라이트', 'Светлая', 'فاتح', 'فاتح'],
    'Automatique': ['Automatic', 'Automático', 'Automatisch', 'Automatico', 'Automático', 'Otomatik', 'स्वचालित', '自动', '自動', '자동', 'Авто', 'تلقائي', 'أوتوماتيك'],
    'Diviser': ['Split', 'Dividir', 'Teilen', 'Dividi', 'Dividir', 'Böl', 'विभाजित करें', '分割', '分割', '분할', 'Разделить', 'تقسيم', 'قسّم'],
    'Enregistrer une vidéo': ['Record a video', 'Grabar un vídeo', 'Video aufnehmen', 'Registra un video', 'Gravar um vídeo', 'Video kaydet', 'वीडियो रिकॉर्ड करें', '录制视频', '動画を録画', '동영상 녹화', 'Записать видео', 'تسجيل فيديو', 'صوّر فيديو'],
    'Aide et assistance': ['Help & support', 'Ayuda y soporte', 'Hilfe & Support', 'Aiuto e supporto', 'Ajuda e suporte', 'Yardım ve destek', 'सहायता और समर्थन', '帮助与支持', 'ヘルプとサポート', '도움말 및 지원', 'Помощь и поддержка', 'المساعدة والدعم', 'المساعدة'],
    'Chercher…': ['Search…', 'Buscar…', 'Suchen…', 'Cerca…', 'Buscar…', 'Ara…', 'खोजें…', '搜索…', '検索…', '검색…', 'Поиск…', 'بحث…', 'قلّب…'],
    'Fermer': ['Close', 'Cerrar', 'Schließen', 'Chiudi', 'Fechar', 'Kapat', 'बंद करें', '关闭', '閉じる', '닫기', 'Закрыть', 'إغلاق', 'سد'],
    'Synchroniser avec AI / Robot': ['Sync with AI / Robot', 'Sincronizar con IA / Robot', 'Mit KI / Roboter synchronisieren', 'Sincronizza con AI / Robot', 'Sincronizar com IA / Robô', 'AI / Robot ile senkronize et', 'AI / रोबोट के साथ सिंक करें', '与 AI / 机器人同步', 'AI / ロボットと同期', 'AI / 로봇과 동기화', 'Синхронизировать с ИИ / роботом', 'المزامنة مع الذكاء الاصطناعي / الروبوت', 'سنكرونيزي مع AI / روبو'],
  };
  var cur = 'fr', subs = [];
  try { var s = localStorage.getItem('lang'); if (s && LANGS.some(function (l) { return l[0] === s; })) cur = s; } catch (e) { /* private mode */ }
  var tr = function (fr) { if (cur === 'fr') return fr; var a = D[fr], i = C.indexOf(cur); return (a && a[i]) || fr; };
  var known = function (fr, t) { return t === fr || (D[fr] || []).indexOf(t) >= 0; };
  var norm = function (t) { return t.replace(/\s+/g, ' ').trim(); };
  var textOrig = new WeakMap(), ATTRS = ['placeholder', 'aria-label', 'title'];
  var skip = function (n) { for (var e = n.nodeType === 1 ? n : n.parentElement; e; e = e.parentElement) { if (/^(SCRIPT|STYLE|TEXTAREA|CODE)$/.test(e.tagName) || e.hasAttribute('data-notr')) return true; } return false; };
  function text(n) {
    var raw = n.nodeValue, t = norm(raw); if (!t) return;
    var fr = textOrig.get(n);
    if (fr !== undefined && !known(fr, t)) fr = undefined;      // the app wrote something new here
    if (fr === undefined) { if (!D[t]) return; fr = t; textOrig.set(n, fr); }
    var want = tr(fr); if (t !== want) n.nodeValue = raw.replace(t, want);
  }
  function attrs(el) {
    var o = el.__tr || (el.__tr = {});
    ATTRS.forEach(function (a) {
      var v = el.getAttribute(a); if (v == null) return; var t = norm(v), fr = o[a];
      if (fr !== undefined && !known(fr, t)) fr = undefined;
      if (fr === undefined) { if (!D[t]) return; fr = o[a] = t; }
      var want = tr(fr); if (t !== want) el.setAttribute(a, want);
    });
  }
  function walk(root) {
    if (!root || skip(root)) return;
    if (root.nodeType === 3) return text(root);
    if (root.nodeType !== 1) return;
    attrs(root);
    for (var c = root.firstChild; c; c = c.nextSibling) walk(c);
  }
  var mo = null;
  function watch() { if (mo) mo.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS }); }
  function apply(roots) { if (mo) mo.disconnect(); roots.forEach(walk); watch(); }
  function boot() {
    mo = new MutationObserver(function (rs) {
      if (cur === 'fr' && !hadOther) return;
      var roots = []; rs.forEach(function (r) { if (r.type === 'childList') r.addedNodes.forEach(function (n) { roots.push(n); }); else roots.push(r.target); });
      apply(roots);
    });
    pageDir(); apply([document.body]);
  }
  var hadOther = cur !== 'fr';
  function pageDir() {
    document.documentElement.lang = cur === 'ary' ? 'ar-MA' : cur;
    var rtl = cur === 'ar' || cur === 'ary';
    ['page', 'modal', 'up-sheet'].forEach(function (id) { var e = document.getElementById(id); if (e) e.setAttribute('dir', rtl ? 'rtl' : 'ltr'); });
  }
  function set(code) {
    if (!LANGS.some(function (l) { return l[0] === code; })) return;
    cur = code; hadOther = hadOther || code !== 'fr';
    try { localStorage.setItem('lang', code); } catch (e) { /* ignore */ }
    pageDir(); apply([document.body]); subs.forEach(function (f) { f(code); });
  }
  window.I18N = { LANGS: LANGS, get: function () { return cur; }, set: set, t: tr, onChange: function (f) { subs.push(f); }, name: function (c) { var l = LANGS.filter(function (x) { return x[0] === c; })[0]; return l ? l[1] : c; } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
