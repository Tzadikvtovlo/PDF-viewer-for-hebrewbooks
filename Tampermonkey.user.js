// ==UserScript==
// @name         ניהול ועיצוב עבור HebrewBooks
// @namespace    http://tampermonkey.net/
// @version      1.2
// @description  Auto-redirect to format B, dynamic header, custom download button with ID-only filename, robust event isolation, and pixel-perfect toolbar anchoring
// @author       צדיק וטוב לו וההודי של gemini
// @match        *://beta.hebrewbooks.org/*
// @match        *://hebrewbooks.org/*
// @match        *://www.hebrewbooks.org/*
// @updateURL    https://raw.githubusercontent.com/Tzadikvtovlo/PDF-viewer-for-hebrewbooks/main/Tampermonkey.user.js
// @downloadURL  https://raw.githubusercontent.com/Tzadikvtovlo/PDF-viewer-for-hebrewbooks/main/Tampermonkey.user.js
// @icon         https://www.google.com/s2/favicons?sz=512&domain=beta.hebrewbooks.org
// @grant        GM_download
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    const currentUrl = new URL(window.location.href);
    const pathname = currentUrl.pathname;
    const pathnameLower = pathname.toLowerCase();

    // --- חלק א': ניווט והפניות (מורחב לכל סוגי הקישורים) ---

    // 1. אם אנחנו בקורא אבל לא בדומיין של הבטא - העברה מיידית לבטא
    if (pathnameLower.includes('reader.aspx') && currentUrl.hostname !== 'beta.hebrewbooks.org') {
        window.location.replace(`https://beta.hebrewbooks.org/reader/reader.aspx${currentUrl.search}${currentUrl.hash}`);
        return;
    }

    let targetBookId = null;
    let targetPageNum = '1';

    // 2. זיהוי לפי pdfpager.aspx
    if (pathnameLower.includes('pdfpager.aspx')) {
        targetBookId = currentUrl.searchParams.get('req');
        targetPageNum = currentUrl.searchParams.get('pgnum') || '1';
    } 
    // 3. זיהוי לפי sefer.aspx (קישורים ישנים מסוימים)
    else if (pathnameLower.includes('sefer.aspx')) {
        targetBookId = currentUrl.searchParams.get('id');
    }
    // 4. זיהוי לפי כתובת מקוצרת (לדוגמה /12345)
    else {
        const shortUrlMatch = pathname.match(/^\/(\d+)\/?$/);
        if (shortUrlMatch) {
            targetBookId = shortUrlMatch[1];
        }
    }

    // אם נמצא מזהה ספר ואנחנו לא בתצוגה המיוחדת - בצע הפניה לתצוגת הקורא המיוחדת
    if (targetBookId && !(currentUrl.hostname === 'beta.hebrewbooks.org' && pathnameLower.includes('reader.aspx'))) {
        window.location.replace(`https://beta.hebrewbooks.org/reader/reader.aspx?sfid=${targetBookId}#p=${targetPageNum}&fitMode=fitwidth&hlts=&ocr=`);
        return;
    }


    // --- חלק ב': חילוץ, ניקוי ובנייה מחדש של ה-Details ---

    if (pathnameLower.includes('reader.aspx')) {
        const bookId = currentUrl.searchParams.get('sfid');
        if (!bookId) return;

        window.addEventListener('DOMContentLoaded', () => {
            fetchBookDetails(bookId);
            setupAnchoringLoop();
        });
    }

    function findFullscreenElement() {
        return document.getElementById('cphMain_btnFullscreen') ||
               document.getElementById('btnFullscreen') ||
               document.querySelector('[title*="מסך מלא"]') ||
               document.querySelector('[title*="Full Screen"]') ||
               document.querySelector('[alt*="מסך מלא"]') ||
               Array.from(document.querySelectorAll('button, a, img, td, div')).find(el => {
                   return (el.textContent && el.textContent.includes('מסך מלא')) ||
                          (el.title && el.title.includes('מסך מלא'));
               });
    }

    function repositionUI() {
        const fsEl = findFullscreenElement();
        if (!fsEl) return;

        const rect = fsEl.getBoundingClientRect();
        const panel = document.getElementById('hb-details-panel');
        const toggle = document.getElementById('hb-details-toggle');

        const targetLeft = rect.right + 10;

        if (panel && panel.style.display !== 'none') {
            panel.style.top = `${rect.top}px`;
            panel.style.left = `${targetLeft}px`;
        }

        if (toggle) {
            toggle.style.top = `${rect.top}px`;
            toggle.style.left = `${targetLeft}px`;
        }
    }

    function setupAnchoringLoop() {
        window.addEventListener('resize', repositionUI);
        window.addEventListener('scroll', repositionUI);
        setInterval(repositionUI, 250);
    }

    function fetchBookDetails(bookId) {
        fetch(`https://beta.hebrewbooks.org/${bookId}`)
            .then(response => response.text())
            .then(html => {
                const parser = new DOMParser();
                const doc = parser.parseFromString(html, 'text/html');

                let detailsBox = doc.querySelector('#divDetails') ||
                                 doc.querySelector('.details-box') ||
                                 doc.querySelector('#cphMain_divDetails') ||
                                 doc.querySelector('#cphMain_pnlDetails');

                if (!detailsBox) {
                    const elements = doc.querySelectorAll('div, table, section');
                    for (let el of elements) {
                        if (el.textContent.includes('Details') && el.children.length > 2) {
                            detailsBox = el;
                            break;
                        }
                    }
                }

                if (detailsBox) {
                    let downloadUrl = '';
                    let downloadSizeStr = '';
                    let linksHtml = '';

                    detailsBox.querySelectorAll('a').forEach(a => {
                        let text = a.textContent.trim();
                        let textLower = text.toLowerCase();

                        if (
                            !text ||
                            textLower.includes('לקרוא מקוון') ||
                            textLower.includes('בדפדפן') ||
                            textLower.includes('בפדדפן') ||
                            textLower.includes('חיפוש בתוך ספר') ||
                            textLower.includes('search in this sefer')
                        ) {
                            return;
                        }

                        if (textLower.includes('הורדה') || textLower.includes('download')) {
                            const sizeMatch = text.match(/(\d+(?:\.\d+)?\s*(?:MB|KB|מ"ב|ק"ב))/i);
                            downloadSizeStr = sizeMatch ? `(${sizeMatch[1].trim()})` : '';
                            downloadUrl = a.href;
                            return;
                        }

                        linksHtml += `<a href="${a.href}" target="_blank">${text}</a>`;
                    });

                    let rowsData = [];
                    let trs = detailsBox.querySelectorAll('tr');

                    let heTitle = '';
                    let enTitle = '';

                    trs.forEach(tr => {
                        let tds = tr.querySelectorAll('td');
                        if (tds.length >= 2) {
                            let label = tds[0].innerText.replace(':', '').trim();
                            let value = tds[1].innerText.trim();
                            let valueHtml = tds[1].innerHTML.trim();

                            if (label.toLowerCase().startsWith('details') || label.toLowerCase() === 'details') {
                                return;
                            }

                            if (label.includes('כותר') || label.includes('שם הספר')) {
                                heTitle = value;
                                return;
                            }
                            if (label.toLowerCase().includes('book name')) {
                                enTitle = value;
                                return;
                            }

                            if (label.toLowerCase().includes('description') || label.includes('תוכן')) {
                                label = 'תוכן';
                            }

                            if (label.includes('דפים') || label.toLowerCase().includes('pages') || label.includes('עמודים')) {
                                label = 'עמודים';
                                let match = value.match(/\d+/);
                                if (match) {
                                    value = match[0];
                                    valueHtml = match[0];
                                }
                            }

                            if (value && value !== '&nbsp;') {
                                rowsData.push({ label, value, valueHtml });
                            }
                        }
                    });

                    let finalBookTitle = 'פרטי הספר';
                    if (heTitle) {
                        finalBookTitle = heTitle + (enTitle ? ` (${enTitle})` : '');
                    } else if (enTitle) {
                        finalBookTitle = enTitle;
                    }

                    let mergedRows = [];
                    let processedIndices = new Set();
                    const pairs = [
                        { he: 'מחבר', en: 'author' },
                        { he: 'נושא', en: 'subject' },
                        { he: 'מקום דפוס', en: 'printing place' },
                        { he: 'שנת דפוס', en: 'printing year' },
                        { he: 'קטגוריה', en: 'category' }
                    ];

                    pairs.forEach(pair => {
                        let heIdx = rowsData.findIndex((r, idx) => !processedIndices.has(idx) && r.label.includes(pair.he));
                        let enIdx = rowsData.findIndex((r, idx) => !processedIndices.has(idx) && r.label.toLowerCase().includes(pair.en));

                        if (heIdx !== -1) {
                            let row = { label: rowsData[heIdx].label, valueHtml: rowsData[heIdx].valueHtml };
                            if (enIdx !== -1) {
                                row.valueHtml += ` <span class="hb-en-val">(${rowsData[enIdx].value})</span>`;
                                processedIndices.add(enIdx);
                            }
                            mergedRows.push(row);
                            processedIndices.add(heIdx);
                        } else if (enIdx !== -1) {
                            mergedRows.push({ label: rowsData[enIdx].label, valueHtml: rowsData[enIdx].valueHtml });
                            processedIndices.add(enIdx);
                        }
                    });

                    rowsData.forEach((r, idx) => {
                        if (!processedIndices.has(idx)) {
                            mergedRows.push({ label: r.label, valueHtml: r.valueHtml });
                        }
                    });

                    let cleanHtml = '';
                    mergedRows.forEach(r => {
                        let cleanLabel = r.label.endsWith(':') ? r.label : r.label + ':';
                        let isContentRow = (r.label === 'תוכן');
                        cleanHtml += `
                            <div class="hb-detail-row ${isContentRow ? 'hb-row-vertical' : ''}">
                                <span class="hb-detail-label">${cleanLabel}</span>
                                <span class="hb-detail-value">${r.valueHtml}</span>
                            </div>`;
                    });

                    let downloadLinkHtml = '';
                    if (downloadUrl) {
                        let safeFileName = `${bookId}.pdf`;

                        downloadLinkHtml = `
                            <a href="${downloadUrl}" id="hb-download-action" data-filename="${safeFileName}" class="hb-download-btn">
                                <svg class="hb-download-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                    <polyline points="7 10 12 15 17 10"></polyline>
                                    <line x1="12" y1="15" x2="12" y2="3"></line>
                                </svg>
                                <span class="hb-download-text">הורדת הקובץ</span>
                                ${downloadSizeStr ? `<span class="hb-download-size">${downloadSizeStr}</span>` : ''}
                            </a>`;
                    }

                    let finalContent = downloadLinkHtml + cleanHtml + `<div class="hb-details-links">${linksHtml}</div>`;
                    injectDetailsUI(finalContent, finalBookTitle);
                }
            })
            .catch(err => console.error('שגיאה בעיבוד פרטי הספר:', err));
    }

    function injectDetailsUI(htmlContent, bookTitle) {
        if (document.getElementById('hb-details-panel')) return;

        const panel = document.createElement('div');
        panel.id = 'hb-details-panel';
        panel.style.display = 'none';

        panel.innerHTML = `
            <div class="hb-details-header" title="לחץ לסגירה">
                <span class="hb-header-title-text" title="${bookTitle}">${bookTitle}</span>
                <button id="hb-details-close">×</button>
            </div>
            <div class="hb-details-body">
                ${htmlContent}
            </div>
        `;

        const stopEvents = (e) => e.stopPropagation();
        ['mousedown', 'mousemove', 'mouseup', 'click', 'selectstart', 'touchstart', 'touchmove'].forEach(evt => {
            panel.addEventListener(evt, stopEvents, { passive: true });
        });

        const style = document.createElement('style');
        style.textContent = `
            #hb-details-panel {
                position: fixed;
                width: 320px;
                height: 440px;
                max-height: 85vh;
                background: linear-gradient(135deg, #ffffff 0%, #fdfcf9 100%);
                border: 1px solid #e2dcd5;
                box-shadow: 0 6px 25px rgba(139, 126, 116, 0.18);
                z-index: 9999999 !important;
                font-family: system-ui, -apple-system, sans-serif;
                border-radius: 10px;
                direction: rtl;
                resize: both;
                overflow: hidden;
                min-width: 280px;
                min-height: 220px;
                pointer-events: auto !important;
                transition: border-color 0.2s ease;
            }
            .hb-details-header {
                height: 45px;
                box-sizing: border-box;
                background: linear-gradient(90deg, #f7f5f0 0%, #eeebe3 100%);
                padding: 12px 15px;
                font-weight: bold;
                color: #4a4339;
                display: flex;
                justify-content: space-between;
                align-items: center;
                border-bottom: 1px solid #e2dcd5;
                user-select: none !important;
                cursor: pointer;
                transition: all 0.2s ease;
            }
            .hb-details-header:hover {
                background: linear-gradient(90deg, #eeebe3 0%, #ede8df 100%) !important;
                border-bottom-color: #c4b9aa;
            }
            #hb-details-panel:has(.hb-details-header:hover) {
                border-color: #c4b9aa;
            }

            .hb-header-title-text {
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                max-width: 240px;
            }
            .hb-details-header button {
                background: none;
                border: none;
                font-size: 22px;
                cursor: pointer;
                color: #a09586;
                line-height: 1;
                transition: color 0.2s ease;
            }
            .hb-details-header button:hover { color: #000; }

            .hb-details-body {
                height: calc(100% - 45px);
                box-sizing: border-box;
                padding: 15px;
                overflow-y: auto;
                overflow-x: hidden !important;
                font-size: 14px;
                line-height: 1.6;
                color: #444;
                text-align: right;
            }

            #hb-details-panel .hb-details-body,
            #hb-details-panel .hb-details-body * {
                user-select: text !important;
                -webkit-user-select: text !important;
            }

            .hb-download-btn {
                position: relative;
                display: flex;
                align-items: center;
                justify-content: center;
                height: 40px;
                box-sizing: border-box;
                margin-bottom: 15px;
                background: #757575;
                color: #ffffff !important;
                border-radius: 6px;
                text-decoration: none;
                font-weight: bold;
                box-shadow: 0 2px 6px rgba(0, 0, 0, 0.12);
                transition: background 0.2s;
                cursor: pointer;
            }
            .hb-download-btn:hover {
                background: #5e5e5e;
                text-decoration: none !important;
            }
            .hb-download-icon {
                position: absolute;
                right: 14px;
                top: 50%;
                transform: translateY(-50%);
            }
            .hb-download-text {
                text-align: center;
                user-select: none !important;
            }
            .hb-download-size {
                position: absolute;
                left: 14px;
                top: 50%;
                transform: translateY(-50%);
                font-size: 12px;
                font-weight: normal;
                opacity: 0.95;
                font-family: sans-serif;
                direction: ltr;
                user-select: none !important;
            }

            .hb-detail-row {
                display: flex;
                flex-direction: row;
                flex-wrap: wrap;
                align-items: flex-start;
                gap: 5px;
                margin-bottom: 8px;
                border-bottom: 1px dashed #f2eee9;
                padding-bottom: 4px;
            }

            .hb-row-vertical {
                flex-direction: column !important;
                align-items: flex-start !important;
            }
            .hb-row-vertical .hb-detail-value {
                width: 100% !important;
                margin-top: 5px;
                background: #fbfaf7;
                padding: 8px;
                border-radius: 4px;
                border: 1px solid #f2eee9;
            }

            .hb-detail-label {
                font-weight: bold;
                color: #2b251f;
                white-space: nowrap;
                user-select: none !important;
            }
            .hb-detail-value {
                color: #4f473f;
            }
            .hb-en-val {
                color: #8c8275;
                font-size: 0.9em;
                font-family: sans-serif;
            }

            .hb-details-links a {
                display: block;
                text-align: center;
                margin: 8px 0;
                padding: 6px;
                background: #f4f1eb;
                border-radius: 4px;
                color: #5d5245;
                text-decoration: none;
                font-weight: bold;
                font-size: 13px;
                border: 1px solid #ede8df;
                user-select: none !important;
            }
            .hb-details-links a:hover {
                background: #e6e1d6;
                text-decoration: underline;
            }

            #hb-details-toggle {
                position: fixed;
                z-index: 9999999 !important;
                background: linear-gradient(90deg, #f7f5f0 0%, #eeebe3 100%) !important;
                color: #4a4339;
                border: 1px solid #e2dcd5;
                width: auto;
                height: 45px;
                box-sizing: border-box;
                padding: 0 14px;
                border-radius: 10px;
                cursor: pointer;
                font-weight: bold;
                box-shadow: 0 4px 12px rgba(139, 126, 116, 0.15);
                font-family: system-ui, -apple-system, sans-serif;
                transition: all 0.2s ease;
                user-select: none !important;

                display: flex;
                align-items: center;
                justify-content: space-between;
                direction: rtl;
                gap: 10px;
            }
            #hb-details-toggle:hover {
                background: linear-gradient(90deg, #eeebe3 0%, #ede8df 100%) !important;
                border-color: #c4b9aa;
            }
            #hb-details-toggle span {
                text-align: right;
            }
            #hb-details-toggle svg {
                color: #8c8275;
                transition: color 0.2s;
                flex-shrink: 0;
            }
            #hb-details-toggle:hover svg {
                color: #4a4339;
            }
        `;

        document.head.appendChild(style);
        document.body.appendChild(panel);

        const downloadActionBtn = panel.querySelector('#hb-download-action');
        if (downloadActionBtn) {
            downloadActionBtn.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();

                const fileUrl = this.getAttribute('href');
                const desiredName = this.getAttribute('data-filename');

                if (typeof GM_download !== 'undefined') {
                    GM_download({
                        url: fileUrl,
                        name: desiredName,
                        onerror: function(err) {
                            console.error('הורדה מותאמת נכשלה, מבצע גיבוי רגיל:', err);
                            window.open(fileUrl, '_blank');
                        }
                    });
                } else {
                    window.open(fileUrl, '_blank');
                }
            });
        }

        const closePanelAction = (e) => {
            e.stopPropagation();
            panel.style.display = 'none';
            createToggleButton();
        };

        panel.querySelector('.hb-details-header').addEventListener('click', closePanelAction);

        createToggleButton();
        setTimeout(repositionUI, 50);

        function createToggleButton() {
            if (document.getElementById('hb-details-toggle')) return;
            const btn = document.createElement('button');
            btn.id = 'hb-details-toggle';

            btn.innerHTML = `
                <span>לפרטי הספר והורדה</span>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="16" x2="12" y2="12"></line>
                    <line x1="12" y1="8" x2="12.01" y2="8"></line>
                </svg>
            `;

            btn.addEventListener('mousedown', stopEvents);
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                panel.style.display = 'block';
                btn.remove();
                setTimeout(repositionUI, 10);
            });
            document.body.appendChild(btn);
            repositionUI();
        }
    }
})();
