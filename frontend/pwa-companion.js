// TgStorage PWA, Web Share Target & iOS Share Sheet Companion
(function () {
  'use strict';

  // 1. Register Service Worker
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').then(function (reg) {
        console.log('[TgStorage] PWA ServiceWorker active:', reg.scope);
      }).catch(function (err) {
        console.warn('[TgStorage] SW registration skipped:', err);
      });
    });
  }

  // 2. Detect iOS environment & standalone mode
  const isIos = /iPhone|iPad|iPod/i.test(navigator.userAgent) && !window.MSStream;
  const isStandalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;

  // 3. Inject Styles for PWA Banner and iOS Share Sheet Modal
  const style = document.createElement('style');
  style.textContent = `
    #tg-ios-banner {
      position: fixed;
      bottom: 16px;
      left: 50%;
      transform: translateX(-50%);
      width: calc(100% - 32px);
      max-width: 480px;
      background: rgba(15, 23, 42, 0.92);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1px solid rgba(124, 58, 237, 0.35);
      border-radius: 16px;
      box-shadow: 0 12px 36px rgba(0, 0, 0, 0.45);
      padding: 14px 16px;
      display: flex;
      align-items: center;
      gap: 12px;
      z-index: 999999;
      color: #fff;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      animation: tgSlideUp 0.4s ease-out;
    }
    @keyframes tgSlideUp {
      from { transform: translate(-50%, 40px); opacity: 0; }
      to { transform: translate(-50%, 0); opacity: 1; }
    }
    #tg-ios-banner .tg-icon {
      width: 44px;
      height: 44px;
      border-radius: 10px;
      background: linear-gradient(135deg, #6366f1, #8b5cf6);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      box-shadow: 0 4px 12px rgba(99, 102, 241, 0.4);
    }
    #tg-ios-banner .tg-info {
      flex: 1;
      min-width: 0;
    }
    #tg-ios-banner .tg-title {
      font-size: 14px;
      font-weight: 600;
      color: #fff;
      margin-bottom: 2px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    #tg-ios-banner .tg-desc {
      font-size: 12px;
      color: #94a3b8;
      line-height: 1.35;
    }
    #tg-ios-banner .tg-btn-help {
      background: #7c3aed;
      color: #fff;
      border: none;
      border-radius: 8px;
      padding: 6px 10px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;
      transition: background 0.2s;
    }
    #tg-ios-banner .tg-btn-help:hover {
      background: #6d28d9;
    }
    #tg-ios-banner .tg-close {
      background: none;
      border: none;
      color: #64748b;
      font-size: 18px;
      cursor: pointer;
      padding: 4px;
      line-height: 1;
    }
    #tg-ios-banner .tg-close:hover {
      color: #cbd5e1;
    }

    /* Floating Share Setup Badge on Desktop/Mobile Header */
    #tg-share-pill {
      position: fixed;
      top: 14px;
      right: 72px;
      background: linear-gradient(135deg, #7c3aed, #4f46e5);
      color: #fff;
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 20px;
      padding: 6px 14px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      z-index: 99999;
      box-shadow: 0 4px 12px rgba(124, 58, 237, 0.35);
      transition: transform 0.2s, box-shadow 0.2s;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    #tg-share-pill:hover {
      transform: translateY(-1px);
      box-shadow: 0 6px 16px rgba(124, 58, 237, 0.45);
    }

    /* Modal Styling */
    .tg-modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.7);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000000;
      padding: 16px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    .tg-modal-content {
      background: #0f172a;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 20px;
      width: 100%;
      max-width: 540px;
      max-height: 90vh;
      overflow-y: auto;
      color: #f8fafc;
      box-shadow: 0 24px 48px rgba(0, 0, 0, 0.6);
      padding: 24px;
      position: relative;
    }
    .tg-modal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 20px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      padding-bottom: 14px;
    }
    .tg-modal-title {
      font-size: 18px;
      font-weight: 700;
      color: #fff;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .tg-modal-close {
      background: none;
      border: none;
      color: #94a3b8;
      font-size: 24px;
      cursor: pointer;
      line-height: 1;
    }
    .tg-step-card {
      background: rgba(30, 41, 59, 0.6);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 14px;
      padding: 16px;
      margin-bottom: 16px;
    }
    .tg-step-title {
      font-size: 14px;
      font-weight: 700;
      color: #c084fc;
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .tg-step-body {
      font-size: 13px;
      color: #cbd5e1;
      line-height: 1.5;
    }
    .tg-code-box {
      background: #020617;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 8px;
      padding: 8px 12px;
      font-family: monospace;
      font-size: 12px;
      color: #38bdf8;
      word-break: break-all;
      margin-top: 8px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .tg-copy-btn {
      background: #334155;
      color: #fff;
      border: none;
      border-radius: 6px;
      padding: 4px 8px;
      font-size: 11px;
      cursor: pointer;
      white-space: nowrap;
    }
    .tg-copy-btn:hover { background: #475569; }

    /* Web Share Target Notification */
    #tg-shared-card {
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: #1e1b4b;
      border: 1px solid #818cf8;
      border-radius: 14px;
      padding: 16px 20px;
      color: #fff;
      box-shadow: 0 16px 32px rgba(0, 0, 0, 0.5);
      z-index: 1000001;
      max-width: 440px;
      width: calc(100% - 32px);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
  `;
  document.head.appendChild(style);

  // 4. Create Floating "📲 Install / Share Sheet" Pill in Header
  function initHeaderPill() {
    if (document.getElementById('tg-share-pill')) return;
    const pill = document.createElement('button');
    pill.id = 'tg-share-pill';
    pill.innerHTML = `
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect>
        <line x1="12" y1="18" x2="12.01" y2="18"></line>
      </svg>
      <span>Install / iOS Share</span>
    `;
    pill.addEventListener('click', openHelpModal);
    document.body.appendChild(pill);
  }

  // 5. iOS Smart Banner (shown only on iOS Safari when not installed yet)
  function initIosBanner() {
    if (!isIos || isStandalone) return;
    if (sessionStorage.getItem('tg_ios_banner_closed')) return;

    const banner = document.createElement('div');
    banner.id = 'tg-ios-banner';
    banner.innerHTML = `
      <div class="tg-icon">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"></path>
          <polyline points="16 16 12 12 8 16"></polyline>
          <line x1="12" y1="12" x2="12" y2="21"></line>
        </svg>
      </div>
      <div class="tg-info">
        <div class="tg-title">
          <span>Install TgStorage</span>
        </div>
        <div class="tg-desc">
          Tap <strong>Share <svg style="display:inline;vertical-align:middle;" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path><polyline points="16 6 12 2 8 6"></polyline><line x1="12" y1="2" x2="12" y2="15"></line></svg></strong> then <strong>"Add to Home Screen"</strong> for fullscreen app & gallery uploads.
        </div>
      </div>
      <button class="tg-btn-help" id="tg-btn-guide">Setup</button>
      <button class="tg-close" id="tg-close-banner">&times;</button>
    `;

    document.body.appendChild(banner);

    document.getElementById('tg-btn-guide').addEventListener('click', openHelpModal);
    document.getElementById('tg-close-banner').addEventListener('click', function () {
      banner.remove();
      sessionStorage.setItem('tg_ios_banner_closed', '1');
    });
  }

  // 6. Help Modal for iOS PWA & Share Sheet
  function openHelpModal() {
    const existing = document.getElementById('tg-help-modal');
    if (existing) existing.remove();

    const origin = window.location.origin;

    const modal = document.createElement('div');
    modal.id = 'tg-help-modal';
    modal.className = 'tg-modal-backdrop';
    modal.innerHTML = `
      <div class="tg-modal-content">
        <div class="tg-modal-header">
          <div class="tg-modal-title">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#a855f7" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect>
              <line x1="12" y1="18" x2="12.01" y2="18"></line>
            </svg>
            <span>iPhone & Android Setup</span>
          </div>
          <button class="tg-modal-close" id="tg-modal-close-btn">&times;</button>
        </div>

        <!-- Section 1: Home Screen PWA Installation -->
        <div class="tg-step-card">
          <div class="tg-step-title">
            <span>1. Install on Phone (PWA)</span>
          </div>
          <div class="tg-step-body">
            <p><strong>iOS (Safari):</strong> Tap the <strong>Share</strong> button <svg style="display:inline;vertical-align:middle;" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path><polyline points="16 6 12 2 8 6"></polyline><line x1="12" y1="2" x2="12" y2="15"></line></svg> at the bottom of Safari, scroll down, and tap <strong>"Add to Home Screen"</strong>.</p>
            <p style="margin-top: 6px;"><strong>Android (Chrome):</strong> Tap the <strong>three dots (&vellip;)</strong> menu &rarr; <strong>"Install app"</strong> or <strong>"Add to Home Screen"</strong>.</p>
            <p style="margin-top: 6px; color:#a5b4fc;"><em>&check; Runs full-screen without browser bars with direct access to camera & photo library.</em></p>
          </div>
        </div>

        <!-- Section 2: Direct Upload from iPhone Photos Share Sheet -->
        <div class="tg-step-card" style="border-color: rgba(168, 85, 247, 0.4); background: rgba(88, 28, 135, 0.2);">
          <div class="tg-step-title" style="color: #e9d5ff;">
            <span>2. Upload from iPhone Photos (Gallery Share Sheet)</span>
          </div>
          <div class="tg-step-body">
            <p>To upload directly when selecting photos in the Apple <strong>Photos app</strong> without opening a browser, use Apple <strong>Shortcuts</strong>:</p>
            <ol style="margin-left: 18px; margin-top: 8px; list-style-type: decimal;">
              <li style="margin-bottom: 4px;">Open the built-in <strong>Shortcuts</strong> app on your iPhone and tap <strong>+</strong>.</li>
              <li style="margin-bottom: 4px;">Tap <strong>(i) Details</strong> at the bottom &rarr; turn ON <strong>"Show in Share Sheet"</strong> (Accepts: Images, Videos).</li>
              <li style="margin-bottom: 4px;">Add action <strong>"Get Contents of URL"</strong>:
                <div class="tg-code-box">
                  <span id="tg-upload-url-code">${origin}/api/files/upload/YOUR_BUCKET_SHARE_CODE</span>
                  <button class="tg-copy-btn" id="tg-copy-url-btn">Copy</button>
                </div>
                <div style="font-size: 11px; color: #94a3b8; margin-top: 4px;">
                  Method: <code>POST</code> &bull; Body: <code>Form</code> &bull; Key: <code>files</code> &rarr; <code>Shortcut Input</code>
                </div>
              </li>
              <li>Add action <strong>"Show Notification"</strong>: <em>"Uploaded to CloudVault!"</em></li>
            </ol>
            <p style="margin-top: 10px; color: #34d399; font-weight: 500;">
              &check; Now in Apple Photos, select any photos/videos &rarr; tap Share &rarr; select "Upload to CloudVault" to upload directly!
            </p>
          </div>
        </div>

        <!-- Section 3: Android Direct Share -->
        <div class="tg-step-card">
          <div class="tg-step-title">
            <span>3. Android Direct Share</span>
          </div>
          <div class="tg-step-body">
            <p>On Android (Chrome / Edge), when you install the PWA, it automatically registers in the <strong>Android System Share Sheet</strong>!</p>
            <p style="margin-top: 4px; color: #94a3b8;">Simply select photos in your gallery &rarr; tap <strong>Share</strong> &rarr; pick <strong>TgStorage</strong> to upload instantly.</p>
          </div>
        </div>

        <button style="width:100%; padding:10px; background:#7c3aed; color:#fff; border:none; border-radius:10px; font-weight:600; cursor:pointer;" id="tg-modal-done-btn">Done</button>
      </div>
    `;

    document.body.appendChild(modal);

    modal.addEventListener('click', function (e) {
      if (e.target === modal) modal.remove();
    });
    document.getElementById('tg-modal-close-btn').addEventListener('click', () => modal.remove());
    document.getElementById('tg-modal-done-btn').addEventListener('click', () => modal.remove());

    const copyBtn = document.getElementById('tg-copy-url-btn');
    if (copyBtn) {
      copyBtn.addEventListener('click', function () {
        const text = document.getElementById('tg-upload-url-code').innerText;
        navigator.clipboard.writeText(text).then(() => {
          copyBtn.innerText = 'Copied!';
          setTimeout(() => (copyBtn.innerText = 'Copy'), 2000);
        }).catch(() => {
          const ta = document.createElement('textarea');
          ta.value = text;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          ta.remove();
          copyBtn.innerText = 'Copied!';
          setTimeout(() => (copyBtn.innerText = 'Copy'), 2000);
        });
      });
    }
  }

  // 7. Web Share Target Queue Reader (for Android/Chrome when opened via Share Target)
  async function checkSharedQueue() {
    if (!window.location.search.includes('shared=1')) return;

    try {
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open('tgstorage_share_target', 1);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });

      const tx = db.transaction('shared_files', 'readwrite');
      const store = tx.objectStore('shared_files');
      const getAllReq = store.getAll();

      getAllReq.onsuccess = function () {
        const items = getAllReq.result || [];
        if (items.length === 0) return;

        let totalFiles = 0;
        items.forEach(it => { if (it.files) totalFiles += it.files.length; });

        // Show shared files banner
        const card = document.createElement('div');
        card.id = 'tg-shared-card';
        card.innerHTML = `
          <div style="font-weight:700; font-size:15px; margin-bottom:4px; display:flex; align-items:center; gap:6px;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
            <span>Received ${totalFiles} File(s) from Gallery</span>
          </div>
          <div style="font-size:12px; color:#cbd5e1; margin-bottom:12px;">
            Ready to upload to your Telegram cloud bucket.
          </div>
          <div style="display:flex; gap:8px;">
            <button id="tg-upload-shared-btn" style="flex:1; background:#7c3aed; color:#fff; border:none; border-radius:8px; padding:8px 12px; font-weight:600; font-size:12px; cursor:pointer;">
              Choose Bucket & Upload
            </button>
            <button id="tg-dismiss-shared-btn" style="background:#334155; color:#fff; border:none; border-radius:8px; padding:8px 12px; font-size:12px; cursor:pointer;">
              Dismiss
            </button>
          </div>
        `;
        document.body.appendChild(card);

        document.getElementById('tg-dismiss-shared-btn').addEventListener('click', () => {
          card.remove();
          // clear DB
          const clearTx = db.transaction('shared_files', 'readwrite');
          clearTx.objectStore('shared_files').clear();
        });

        document.getElementById('tg-upload-shared-btn').addEventListener('click', () => {
          card.remove();
          // Trigger the file dropzone or upload input if available on page
          const dropzone = document.querySelector('input[type="file"]') || document.querySelector('[role="button"]');
          if (dropzone) dropzone.scrollIntoView({ behavior: 'smooth' });
        });
      };
    } catch (e) {
      console.warn('[TgStorage] Could not read shared queue:', e);
    }
  }

  // Initialize after DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initHeaderPill();
      initIosBanner();
      checkSharedQueue();
    });
  } else {
    initHeaderPill();
    initIosBanner();
    checkSharedQueue();
  }
})();
