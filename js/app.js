(() => {
  'use strict';
  const $ = (s) => document.querySelector(s), arr = (v) => Array.isArray(v) ? v : [];
  const esc = (v) => String(v ?? '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c]);
  const safeUrl = (v) => /^https?:\/\//i.test(String(v || '')) ? esc(v) : '';
  const state = { data: null, page: 'home', taskFilter: '未完了', meetingFilter: 'すべて', meetingTab: 'minutes', reviewDate: '', day: '', tab: 'summary' };
  const speaker = (v) => state.data?.speaker_names?.[v] || v || '話者未設定';
  const link = (url) => safeUrl(url) ? `<a class="notion-link" href="${safeUrl(url)}" target="_blank" rel="noopener">Notionで開く ↗</a>` : '';
  const fmt = (v) => v ? esc(String(v).replace('T', ' ').replace(/:\d\d(?:[+-].*)?$/, '')) : '—';
  const updated = (v) => { const d = new Date(v); return Number.isNaN(d.getTime()) ? '—' : `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const label = (v) => { const d = new Date(`${v}T00:00:00`); return `${esc(v)} ${Number.isNaN(d.getTime()) ? '' : ['日','月','火','水','木','金','土'][d.getDay()] + '曜日'}`; };
  const WD = ['日','月','火','水','木','金','土'];
  const stamp = (v, big = false) => { const d = new Date(`${v}T00:00:00`); if (Number.isNaN(d.getTime())) return ''; return `<span class="stamp${big ? ' big' : ''}" aria-label="${esc(label(v))}"><small>${d.getFullYear()}</small><b>${d.getMonth() + 1}.${String(d.getDate()).padStart(2, '0')}</b><small>${WD[d.getDay()]}</small></span>`; };
  const jpDate = (v) => { const d = new Date(`${v}T00:00:00`); return Number.isNaN(d.getTime()) ? esc(v) : `${d.getMonth() + 1}月${d.getDate()}日（${WD[d.getDay()]}）`; };
  const empty = (v = '表示できる記録はありません') => `<p class="empty">${esc(v)}</p>`;
  const setView = (html) => { $('#view').innerHTML = html; bind(); };

  function db() { return new Promise((ok, ng) => { const r = indexedDB.open('work-brief-key', 1); r.onupgradeneeded = () => r.result.createObjectStore('keys'); r.onsuccess = () => ok(r.result); r.onerror = () => ng(r.error); }); }
  async function getKey() { try { const d = await db(); return await new Promise((ok, ng) => { const r = d.transaction('keys').objectStore('keys').get('main'); r.onsuccess = () => ok(r.result); r.onerror = () => ng(r.error); }); } catch { return null; } }
  async function putKey(value) { const d = await db(); return new Promise((ok, ng) => { const r = d.transaction('keys', 'readwrite').objectStore('keys').put(value, 'main'); r.onsuccess = ok; r.onerror = () => ng(r.error); }); }
  async function clearKey() { try { const d = await db(); await new Promise((ok, ng) => { const r = d.transaction('keys', 'readwrite').objectStore('keys').clear(); r.onsuccess = ok; r.onerror = () => ng(r.error); }); } catch {} }
  const b64 = (v) => Uint8Array.from(atob(v), (c) => c.charCodeAt(0));
  async function derive(pass, env) { if (!(Number(env.iter) >= 100000)) throw new Error('iter'); const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']); return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: b64(env.salt), iterations: Number(env.iter) }, material, { name: 'AES-GCM', length: 256 }, false, ['decrypt']); }
  async function decode(env, key) { const bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(env.iv) }, key, b64(env.ct)); let stream = new Blob([bytes]).stream(); if (env.gzip) { if (!window.DecompressionStream) throw new Error('gzip非対応'); stream = stream.pipeThrough(new DecompressionStream('gzip')); } return JSON.parse(await new Response(stream).text()); }
  async function unlock(pass) { const res = await fetch('data.enc.json', { cache: 'no-cache' }); if (!res.ok) throw new Error('data'); const env = await res.json(), old = await getKey(); try { let key; if (!pass && old && old.salt === env.salt) key = old.key; else if (pass) key = await derive(pass, env); else throw new Error('need'); state.data = await decode(env, key); state.key = key; if (pass) await putKey({ salt: env.salt, key }); $('#updated').textContent = `最終更新 ${updated(state.data.generated_at)}`; $('#lock').classList.add('hidden'); $('#app').classList.remove('hidden'); render(); } catch (e) { if (!pass && old) await clearKey(); if (pass) throw e; } }

  function urgent() { const now = new Date(`${String(state.data.today || '2100-01-01').slice(0,10)}T00:00:00`), groups = { '期限切れ': [], '今日期限': [], '承認待ち': [], 'あと2日': [], '停滞': [] }; arr(state.data.tasks).filter((t) => !['完了','却下'].includes(t.status)).forEach((t) => { const d = t.due ? new Date(`${String(t.due).slice(0,10)}T00:00:00`) : null; if (d && d < now) groups['期限切れ'].push(t); else if (d && d.getTime() === now.getTime()) groups['今日期限'].push(t); else if (t.status === '要確認') groups['承認待ち'].push(t); else if (d && (d-now)/86400000 <= 2) groups['あと2日'].push(t); else if (t.status === '未着手' && t.created_time && (now-new Date(t.created_time))/86400000 > 7) groups['停滞'].push(t); }); return groups; }
  function home() { const needs = Object.entries(urgent()).flatMap(([n, ts]) => ts.slice(0,2).map((t) => `<li><b>${esc(n)}</b> ${esc(t.title)}</li>`)); const days = arr(state.data.daily).slice().sort((a,b) => String(b.date).localeCompare(String(a.date)));
    const alert = state.data.health?.alert;
    const alertHtml = alert ? `<section class="alert"><p class="eyebrow">夜間処理が止まっています</p><h2>${esc(alert.title)}</h2>${alert.detail ? `<p>${esc(alert.detail)}</p>` : ''}<p class="calm">PCの処理が直るまで、このアプリの内容は更新されません。</p></section>` : '';
    const lects = arr(state.data.meetings).filter((m) => m.lecture);
    const impCount = lects.reduce((n, m) => n + arr(m.lecture.points).filter((p) => p.important).length, 0);
    const reviewHtml = lects.length ? `<button class="big-entry" data-action="review"><b>研修のおさらい</b><span>講義 ${lects.length}本　重要ポイント ${impCount}</span></button>` : '';
    const dayRow = (d) => `<button class="day-card" data-day="${esc(d.date)}">${stamp(d.date)}<div class="day-body"><p>${esc(firstSentence(d.summary) || '要約はありません')}</p><div class="chips"><span>発話 ${Math.round(Number(d.speech_min)||0)}分</span>${Number(d.meeting_count) ? '<span class="meeting">会議あり</span>' : ''}${Number(d.risk_count) ? `<em>リスク ${Number(d.risk_count)}</em>` : ''}</div></div></button>`;
    const recent = days.slice(0, 7), older = days.slice(7);
    setView(`<section class="page-title"><h1>録音の記録</h1></section>${alertHtml}<button class="search-row" data-action="search"><svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/></svg>検索</button><section class="attention"><div class="section-line"><h2>対応が必要なもの<span class="count${needs.length ? '' : ' zero'}">${needs.length}</span></h2><button data-page="tasks" class="text-button">タスクを見る</button></div>${needs.length ? `<ul>${needs.join('')}</ul>` : '<p class="calm">期限が近い未完了タスクはありません。</p>'}</section>${reviewHtml}<h2 class="section-title">日別の録音</h2>${days.length ? `<div class="day-list">${recent.map(dayRow).join('')}</div>${fold('それより前の日', older.length, `<div class="day-list">${older.map(dayRow).join('')}</div>`)}` : empty()}`); }
  function tasks() { const data = arr(state.data.tasks).filter((t) => state.taskFilter === 'すべて' || (state.taskFilter === '未完了' ? !['完了','却下'].includes(t.status) : t.status === state.taskFilter)).sort((a,b) => String(a.due||'9999').localeCompare(String(b.due||'9999'))); setView(`<section class="page-title"><h1>タスク</h1><p>書き換えはNotionで</p></section><button class="filter-button" data-action="filter">${esc(state.taskFilter)} <span>⌄</span></button>${data.length ? data.map((t) => `<article class="task-card"><div class="task-head"><div><h2>${esc(t.title || '名称未設定')}</h2><p>${esc(t.genre || '')}${t.person ? ` ・ ${esc(t.person)}` : ''}</p></div><span class="status ${statusClass(t.status)}">${esc(t.status || '未設定')}</span></div><p class="due">${t.due ? `期限　${fmt(t.due)}` : '<span class="muted">期限なし</span>'}</p>${t.quote ? `<blockquote>${esc(t.quote)}</blockquote>` : ''}${link(t.url)}</article>`).join('') : empty('該当するタスクはありません')}`); }
  function personDays(p) { const names = new Set([p.name, p.id]); return Object.entries(state.data.daily_detail || {}).filter(([,d]) => arr(d.people).some((x) => names.has(x.name_guess) || names.has(speaker(x.speaker_label)) || x.speaker_label === p.id)).sort(([a],[b]) => b.localeCompare(a)); }
  function people() { const list = arr(state.data.people).slice().sort((a,b) => (/^(未設定|不明|話者)/.test(b.name||'') ? 1 : 0) - (/^(未設定|不明|話者)/.test(a.name||'') ? 1 : 0) || Number(b.count||0)-Number(a.count||0)); setView(`<section class="page-title"><h1>人物</h1><p>会話に登場した人をたどる</p></section>${list.length ? list.map((p) => `<button class="person-card" data-person="${esc(p.id)}"><div><h2>${esc(p.name||'名前未設定')}</h2><p>${esc([p.org,p.relation].filter(Boolean).join(' ・ '))}</p></div><div class="person-meta"><b>${Number(p.count)||0}回</b><span>${fmt(p.last_seen)}</span></div></button>`).join('') : empty()}`); }
  // 一覧は「未設定」を先頭に並べ替えて表示するので、並び順の番号ではなくIDで引く
  function personDetail(id) { const p = arr(state.data.people).find((x) => x.id === id); if (!p) return; const days = personDays(p); setView(`<button class="back" data-back="people">‹ 人物へ戻る</button><section class="page-title"><h1>${esc(p.name||'名前未設定')}</h1><p>${esc([p.org,p.relation].filter(Boolean).join(' ・ '))}</p></section>${p.memo ? `<details class="memo"><summary>メモ</summary><p>${esc(p.memo)}</p></details>` : ''}<h2 class="section-title">登場した日</h2>${days.length ? days.map(([date,d]) => `<button class="day-card compact" data-day="${esc(date)}"><b>${label(date)}</b><p>${esc(d.summary||'')}</p></button>`).join('') : empty('登場日の詳細はありません')}${link(p.url)}`); }
  function more() { setView(`<section class="page-title"><h1>その他</h1><p>案件とナレッジ</p></section><button class="more-row" data-action="threads">案件 <span>${arr(state.data.threads).length}件　›</span></button><button class="more-row" data-action="knowledge">ナレッジ <span>${arr(state.data.knowledge).length}件　›</span></button><button class="more-row" data-action="settings">設定 <span>›</span></button>`); }
  function threads() { const list = arr(state.data.threads); setView(`<button class="back" data-back="more">‹ その他へ戻る</button><section class="page-title"><h1>案件</h1></section>${list.length ? list.map((t) => `<article class="task-card"><div class="task-head"><h2>${esc(t.name)}</h2><span class="status ${statusClass(t.status)}">${esc(t.status)}</span></div><p>${esc(t.next_action||'')}</p><p class="muted">最終言及 ${fmt(t.last_mention)}</p>${link(t.url)}</article>`).join('') : empty()}`); }
  function knowledge() { const list = arr(state.data.knowledge); setView(`<button class="back" data-back="more">‹ その他へ戻る</button><section class="page-title"><h1>ナレッジ</h1></section>${list.length ? list.map((k,i) => `<button class="more-row" data-knowledge="${i}">${esc(k.name)} <span>${fmt(k.updated)}　›</span></button>`).join('') : empty()}`); }
  function knowledgeDetail(i) { const k = arr(state.data.knowledge)[i]; if (k) setView(`<button class="back" data-back="knowledge">‹ ナレッジへ戻る</button><section class="page-title"><h1>${esc(k.name)}</h1><p>${fmt(k.updated)}</p></section><article class="read-card markdown">${markdown(k.text)}</article>`); }

  const bullets = (v) => arr(v).length ? `<ul>${arr(v).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '';
  const section = (title, html) => html ? `<section class="detail-section"><h2>${title}</h2>${html}</section>` : '';
  // ---- 読みやすく出すための部品 ----
  // 長い文章は段落のまま出さず、「。」で区切って1文ずつ並べる
  const sentences = (v) => String(v || '').replace(/([。！？])/g, '$1\n').split('\n').map((x) => x.trim()).filter(Boolean);
  const firstSentence = (v) => sentences(v)[0] || '';
  const lineList = (items) => items.length ? `<ul class="lines">${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '';
  // 最初の max 文だけ見せて、残りは「続きを読む」に畳む
  const readLines = (v, max = 3) => { const s = sentences(v); const rest = s.slice(max); return lineList(s.slice(0, max)) + (rest.length ? `<details class="more-text"><summary>続きを読む（あと${rest.length}文）</summary>${lineList(rest)}</details>` : ''); };
  // 見出しと件数だけ見せて、押すと開く欄。量が多くても終わりが見える
  const fold = (title, count, html, open = false, id = '') => html ? `<details class="fold"${open ? ' open' : ''}${id ? ` id="${id}"` : ''}><summary><span>${title}</span>${count ? `<em>${count}</em>` : ''}</summary><div class="fold-body">${html}</div></details>` : '';
  // 議事録: 日付をまたいで一覧し、開くと議題ごとの経緯・決定・やることを全部見せる
  function kindClass(kind) { return ({ '朝礼': 'kind-morning', '研修': 'kind-training', '会議': 'kind-meeting', '打ち合わせ': 'kind-talk', '商談': 'kind-sales' })[kind] || 'kind-meeting'; }
  function meetingCard(m) { const L = m.lecture; const start = String(m.time || '').match(/\d{1,2}:\d{2}/)?.[0] || ''; const meta = L ? `${arr(m.parts).length > 1 ? `${arr(m.parts).length}コマ　` : ''}学んだこと ${arr(L.points).length}　重要 ${arr(L.points).filter((x) => x.important).length}` :`決定 ${arr(m.decisions).length}件${arr(m.todos).length ? `　やること ${arr(m.todos).length}件` : ''}`; return `<button class="meeting-card list" data-meeting="${esc(m.id)}"><div class="meeting-head"><span class="kind-badge ${kindClass(m.kind)}">${esc(m.kind || (L ? '研修' : '会議'))}</span>${L ? '<span class="lec-badge">講義ノート</span>' : ''}<span class="muted">${jpDate(m.date)}${start ? ` ${esc(start)}` : ''}</span></div><b>${esc(m.title)}</b><p class="muted">${meta}</p></button>`; }
  // 日付ごとにまとめて並べる（新しい日が上、同じ日の中は時刻順）
  function meetings() {
    const all = arr(state.data.meetings); const lectures = all.filter((m) => m.lecture);
    const tabs = `<div class="segments"><button data-mtab="minutes" class="${state.meetingTab === 'minutes' ? 'active' : ''}">議事録 ${all.length - lectures.length}</button><button data-mtab="lectures" class="${state.meetingTab === 'lectures' ? 'active' : ''}">講義ノート ${lectures.length}</button></div>`;
    const byDate = (list) => { const dates = [...new Set(list.map((m) => m.date))].sort().reverse(); return dates.map((d) => `<h3 class="date-head">${jpDate(d)}</h3>${list.filter((m) => m.date === d).sort((a, b) => String(a.time).localeCompare(String(b.time))).map(meetingCard).join('')}`).join(''); };
    if (state.meetingTab === 'lectures') {
      // 講義ノート: 研修・講義の分だけ。上に「おさらい」の入口、下に日付ごとの一覧
      const days = new Set(lectures.map((m) => m.date)); const imp = lectures.reduce((n, m) => n + arr(m.lecture.points).filter((p) => p.important).length, 0);
      setView(`<section class="page-title"><h1>講義ノート</h1></section>${tabs}`
        + (lectures.length ? `<button class="big-entry" data-action="review"><b>研修のおさらい</b><span>重要ポイント・覚える数値・宿題</span></button><div class="stat-row"><span>講義<b>${lectures.length}</b>本</span><span>日数<b>${days.size}</b></span><span>重要<b>${imp}</b></span></div>${byDate(lectures)}` : empty('講義ノートはまだありません。研修・講義・勉強会の録音から自動で作られます')));
      return;
    }
    // 議事録: 講義ノート以外（会議・朝礼・打ち合わせ・商談）
    const minutes = all.filter((m) => !m.lecture); const kinds = ['すべて', ...new Set(minutes.map((m) => m.kind || '会議'))];
    if (!kinds.includes(state.meetingFilter)) state.meetingFilter = 'すべて';
    const list = minutes.filter((m) => state.meetingFilter === 'すべて' || (m.kind || '会議') === state.meetingFilter);
    setView(`<section class="page-title"><h1>議事録</h1></section>${tabs}<div class="chip-row">${kinds.map((k) => `<button class="chip ${k === state.meetingFilter ? 'selected' : ''}" data-meeting-filter="${esc(k)}">${esc(k)} ${k === 'すべて' ? minutes.length : minutes.filter((m) => (m.kind || '会議') === k).length}</button>`).join('')}</div>${list.length ? byDate(list) : empty('議事録はまだありません。10分以上・2人以上の会話から自動で作られます')}`);
  }
  function meetingDetail(id) { const m = arr(state.data.meetings).find((x) => x.id === id); if (!m) return; if (m.lecture) { state.meetingTab = 'lectures'; return lectureDetail(m); } const agenda = arr(m.agenda).map((a, i) => `<article class="agenda-item"><b>${i + 1}. ${esc(a.topic)}</b>${a.discussion ? `<p>${esc(a.discussion)}</p>` : ''}${a.conclusion ? `<p class="conclusion">結論　${esc(a.conclusion)}</p>` : ''}</article>`).join(''); const todos = arr(m.todos).map((t) => `${t.what}${t.who ? `（${t.who}）` : ''}${t.due ? `　期限 ${t.due}` : ''}`); setView(`<button class="back" data-back="meetings">‹ 議事録へ戻る</button><section class="page-title"><span class="kind-badge ${kindClass(m.kind)}">${esc(m.kind || '会議')}</span><h1>${esc(m.title)}</h1><p>${label(m.date)}${m.time ? ` ・ ${esc(m.time)}` : ''}</p></section>${m.purpose ? `<article class="summary-lead">${esc(m.purpose)}</article>` : ''}${arr(m.attendees).length ? `<div class="chips attendees">${arr(m.attendees).map((a) => `<span>${esc(speaker(a))}</span>`).join('')}</div>` : ''}${section('議題', agenda)}${section('決定事項', bullets(m.decisions))}${section('やること', bullets(todos))}${section('持ち越し・未決', bullets(m.pending))}${section('メモ', bullets(m.notes))}${materialsSection(arr(state.data.daily_detail?.[m.date]?.materials).filter((x) => !arr(m.materials).length || arr(m.materials).includes(x.name)))}${state.data.daily_detail?.[m.date] ? `<button class="more-row" data-day="${esc(m.date)}">この日の記録を見る <span>›</span></button>` : ''}`); }
  function summary(d) { const risks = arr(d.risks).map((r) => `<article class="risk ${sevClass(r.severity)}"><b>${esc(r.severity)}　${esc(r.category)}</b><p>${esc(r.why)}</p>${r.action ? `<p>対応: ${esc(r.action)}</p>` : ''}${r.quote ? `<blockquote>${esc(r.quote)}</blockquote>` : ''}</article>`).join(''); const seenCards = new Set(); const meetingCards = arr(d.meetings).map((m) => { const full = arr(state.data.meetings).find((x) => x.date === state.day && (x.title === m.title || arr(x.parts).some((pt) => pt.title === m.title))); if (full && seenCards.has(full)) return ''; if (full) seenCards.add(full); return full ? meetingCard(full) :`<article class="meeting-card"><b>${esc(m.title)}</b><p>${esc(m.time)}　${esc(m.kind)}</p>${bullets(arr(m.agenda).map((a) => `${a.topic||''}：${a.conclusion||a.discussion||''}`))}</article>`; }).filter(Boolean); const meetings = meetingCards.join(''); const questions = arr(d.questions).map((q) => `<article class="meeting-card"><b>${esc(q.question)}</b><p>${esc(q.why)}</p>${arr(d.research).filter((r) => r.question === q.question).map((r) => `<p>${esc(r.answer)}</p>`).join('')}</article>`).join('');
    return `<article class="summary-lead">${readLines(d.summary || '要約はありません', 3)}${link(d.notion_url)}</article>`
      + fold('決定事項', arr(d.decisions).length, bullets(d.decisions), true)
      + fold('議事録', meetingCards.length, meetings, true)
      + fold('リスク', arr(d.risks).length, risks)
      + fold('気づき', arr(d.insights).length, bullets(d.insights))
      + fold('ハイライト', arr(d.highlights).length, bullets(d.highlights))
      + materialsSection(d.materials)
      + fold('疑問と調べた答え', arr(d.questions).length, questions); }
  // 作業カメラのコマ: 会話の間に写っていたものを数枚と一言で添える（映像が無い日は何も出ない）
  const timeChip = (date, t) => t ? `<button class="time-chip" data-jump="${esc(date)}|${esc(t)}" aria-label="${esc(t)} の文字起こしを開く">${esc(t)} の発言</button>` : '';
  function quizList(items) { return items.map((q, i) => `<details class="quiz"><summary><span class="quiz-no" aria-label="問${i + 1}">${i + 1}</span><span>${esc(q.q)}</span></summary><div class="quiz-a"><b>答え</b><p>${esc(q.a)}</p>${slideRow(q.slide_ids)}${timeChip(q.date, q.time)}</div></details>`).join(''); }
  // 確認テストを1問ずつ解く。何問目か・残りがいつも見える
  function startQuiz(items) { if (!arr(items).length) return; state.qz = { items: arr(items), i: 0, shown: false }; showQuiz(); }
  function showQuiz() {
    const z = state.qz; if (!z) return;
    const q = z.items[z.i];
    if (!q) { openSheet(`<div class="qz"><h2 class="qz-done">${z.items.length}問おわり</h2><button class="primary" data-qz="restart">はじめからもう一度</button><button class="sheet-choice" data-qz="close">閉じる</button></div>`); return; }
    const big = arr(q.slide_ids).map((id) => `<div class="slide-big"><img data-slide-img="${esc(id)}" alt="答えのスライド"></div>`).join('');
    openSheet(`<div class="qz"><div class="qz-top"><span>${z.i + 1} / ${z.items.length}</span><button class="text-button" data-qz="close">やめる</button></div><div class="qz-bar"><i style="width:${Math.round((z.i + 1) / z.items.length * 100)}%"></i></div><p class="qz-q">${esc(q.q)}</p>${z.shown ? `<div class="qz-a"><b>答え</b><p>${esc(q.a)}</p>${big}</div>` : ''}<div class="qz-nav"><button class="qz-prev" data-qz="prev"${z.i ? '' : ' disabled'}>前へ</button>${z.shown ? '<button class="primary" data-qz="next">次の問題</button>' : '<button class="primary" data-qz="show">答えを見る</button>'}</div></div>`);
    $('#sheet').scrollTop = 0;
  }
  const slideCache = new Map();
  async function slideUrl(id) {
    if (slideCache.has(id)) return slideCache.get(id);
    const p = (async () => { const res = await fetch(`slides/${id}.json`); if (!res.ok) throw new Error('slide'); const env = await res.json(); const bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(env.iv) }, state.key, b64(env.ct)); return URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' })); })();
    slideCache.set(id, p); p.catch(() => slideCache.delete(id)); return p;
  }
  const slideRow = (ids) => arr(ids).length ? `<div class="slide-row">${arr(ids).map((id) => `<button class="slide-thumb" data-slide="${esc(id)}" aria-label="スライドを拡大"><img data-slide-img="${esc(id)}" alt="講義のスライド"></button>`).join('')}</div>` : '';
  function loadSlides() {
    if (!state.key) return;
    document.querySelectorAll('img[data-slide-img]:not([src])').forEach((img) => { if (img.closest('details:not([open])')) return; slideUrl(img.dataset.slideImg).then((url) => { img.src = url; }).catch(() => { (img.closest('.slide-thumb') || img.closest('.slide-big'))?.classList.add('missing'); }); });
  }
  function openSlide(id) {
    slideUrl(id).then((url) => { openSheet(`<div class="slide-full"><img src="${url}" alt="講義のスライド"></div><p class="muted">ピンチで拡大できます</p>`); }).catch(() => {});
  }
  // 学んだことの1項目。閉じた状態では「題名＋一言」だけ。押すと説明・図・時刻が開く
  function pointFold(p, no, id, date, extra = '') {
    const s = sentences(p.body);
    return `<details class="lec-point${p.important ? ' important' : ''}" id="${id}"><summary><span class="no">${no}</span><span class="pt"><b>${p.important ? `<span class="mk">${esc(p.title)}</span>` : esc(p.title)}</b>${s[0] ? `<span class="gist">${esc(s[0])}</span>` : ''}</span></summary><div class="pt-body">${p.important && p.why ? `<p class="imp-why"><span class="imp-tag">重要</span>${esc(p.why)}</p>` : ''}${lineList(s.slice(1))}${slideRow(p.slide_ids)}<div class="pt-foot">${timeChip(date, p.time)}${extra}</div></div></details>`;
  }
  function lectureDetail(m) {
    const L = m.lecture || {}; const points = arr(L.points); const imp = points.filter((p) => p.important);
    const startTime = String(m.time || '').match(/\d{1,2}:\d{2}/)?.[0] || '';
    const quiz = arr(L.quiz).map((q) => ({ ...q, date: m.date }));
    state.quizSet = quiz;
    // 続きの講義を束ねたノートは、コマ（休憩で切れた区切り）ごとに見出しを入れる
    const parts = arr(m.parts); const partHead = (i) => { const pt = parts[i]; const t = String(pt?.time || '').match(/\d{1,2}:\d{2}/)?.[0] || ''; return `<h3 class="lec-part" id="lpart-${Number(i)}"><span class="no">${i + 1}コマ目</span>${t ? `<time>${esc(t)}</time>` : ''}<b>${esc(pt?.title || '')}</b></h3>`; };
    let seenPart = -1;
    const pointHtml = points.map((p, i) => `${parts.length > 1 && p.part !== undefined && p.part !== seenPart ? (seenPart = p.part, partHead(Number(p.part))) : ''}${pointFold(p, i + 1, `lp-${i}`, m.date)}`).join('');
    const partsHtml = parts.length > 1 ? `<ol class="lec-parts">${parts.map((pt, i) => { const t = String(pt.time || '').match(/\d{1,2}:\d{2}/)?.[0] || ''; const inner = `${t ? `<time>${esc(t)}</time>` : ''}${esc(pt.title)}`; return `<li>${Number(pt.points) > 0 ? `<button class="link" data-scroll="lpart-${i}">${inner}</button>` : `<span class="muted">${inner}</span>`}</li>`; }).join('')}</ol>` : '';
    const impHtml = imp.length ? `<ol class="imp-list">${imp.map((p) => `<li><button class="link" data-scroll="lp-${points.indexOf(p)}"><span class="mk">${esc(p.title)}</span></button></li>`).join('')}</ol>` : '';
    const steps = arr(L.steps).map((st) => `<article class="lec-steps"><b>${esc(st.title)}</b><ol>${arr(st.items).map((x) => `<li>${esc(x)}</li>`).join('')}</ol></article>`).join('');
    const numbers = arr(L.numbers).length ? `<table class="lec-table"><tbody>${arr(L.numbers).map((n) => `<tr><th>${esc(n.item)}</th><td><b>${esc(n.value)}</b>${n.note ? `<span>${esc(n.note)}</span>` : ''}</td></tr>`).join('')}</tbody></table>` : '';
    const terms = arr(L.terms).length ? `<dl class="lec-terms">${arr(L.terms).map((t) => `<dt>${esc(t.term)}</dt><dd>${esc(t.meaning)}</dd>`).join('')}</dl>` : '';
    const qa = arr(L.qa).map((q) => `<article class="lec-qa"><p><b>Q</b><span>${esc(q.q)}</span></p><p><b>A</b><span>${esc(q.a)}</span></p></article>`).join('');
    const agenda = arr(m.agenda).map((a, i) => `<article class="agenda-item"><b>${i + 1}. ${esc(a.topic)}</b>${a.discussion ? `<p>${esc(a.discussion)}</p>` : ''}${a.conclusion ? `<p class="conclusion">結論　${esc(a.conclusion)}</p>` : ''}</article>`).join('');
    const toc = [['lec-imp', '重要', imp.length], ['lec-points', '学んだこと', points.length], ['lec-numbers', '数値', arr(L.numbers).length], ['lec-terms', '用語', arr(L.terms).length], ['lec-steps', '手順', arr(L.steps).length]].filter((x) => x[2]).map((x) => `<button class="chip" data-scroll="${x[0]}">${x[1]} ${x[2]}</button>`).join('');
    const sec = (id, title, html) => html ? `<section class="detail-section" id="${id}"><h2>${title}</h2>${html}</section>` : '';
    setView(`<button class="back" data-back="meetings">‹ 講義ノートへ戻る</button><section class="page-title"><h1>${esc(m.title)}</h1><p>${jpDate(m.date)}${startTime ? ` ${esc(startTime)}から` : ''}</p></section>${partsHtml || (L.theme ? `<p class="lec-theme">${esc(firstSentence(L.theme))}</p>` : '')}<div class="chip-row lec-toc">${toc}</div>`
      + sec('lec-imp', 'まずここを覚える', impHtml)
      + sec('lec-points', '学んだこと', `<p class="hint">押すと説明と図が開きます</p>${pointHtml}`)
      + fold('覚える数値', arr(L.numbers).length, numbers, false, 'lec-numbers')
      + fold('用語', arr(L.terms).length, terms, false, 'lec-terms')
      + fold('手順', arr(L.steps).length, steps, false, 'lec-steps')
      + fold('質疑応答', arr(L.qa).length, qa)
      + fold('宿題・次回の連絡', arr(L.homework).length, bullets(L.homework), true)
      + fold('聞き取れず確かめたい所', arr(L.unclear).length, bullets(L.unclear))
      + fold('元の議事録（要約）', arr(m.agenda).length, agenda ? agenda + bullets(m.notes) : '')
      + materialsSection(arr(state.data.daily_detail?.[m.date]?.materials).filter((x) => !arr(m.materials).length || arr(m.materials).includes(x.name)))
      + (state.data.transcripts?.[m.date] ? `<button class="more-row" data-jump="${esc(m.date)}|${esc(startTime)}">この講義の文字起こしを読む <span>›</span></button>` : '')
      + (state.data.daily_detail?.[m.date] ? `<button class="more-row" data-day="${esc(m.date)}">この日の記録を見る <span>›</span></button>` : ''));
  }
  function review() {
    state.page = 'meetings'; state.meetingTab = 'lectures';
    const lects = arr(state.data.meetings).filter((m) => m.lecture);
    const dates = ['すべて', ...[...new Set(lects.map((m) => m.date))].sort()];
    if (!dates.includes(state.reviewDate)) state.reviewDate = dates[dates.length - 1];  // 最初は直近の日だけ（全部だと終わりが見えない）
    const list = lects.filter((m) => state.reviewDate === 'すべて' || m.date === state.reviewDate).sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
    const imp = list.flatMap((m) => arr(m.lecture.points).filter((p) => p.important).map((p) => ({ ...p, m })));
    const nums = list.flatMap((m) => arr(m.lecture.numbers).map((n) => ({ ...n, m })));
    const quiz = list.flatMap((m) => arr(m.lecture.quiz).map((q) => ({ ...q, date: m.date })));
    const hw = list.flatMap((m) => arr(m.lecture.homework).map((h) => `${jpDate(m.date)}　${h}`));
    state.quizSet = quiz;
    const impHtml = imp.map((p, i) => pointFold(p, i + 1, `rp-${i}`, p.m.date, `<button class="link" data-meeting="${esc(p.m.id)}">${esc(p.m.title)} のノート</button>`)).join('');
    const numHtml = nums.length ? `<table class="lec-table"><tbody>${nums.map((n) => `<tr><th>${esc(n.item)}</th><td><b>${esc(n.value)}</b>${n.note ? `<span>${esc(n.note)}</span>` : ''}</td></tr>`).join('')}</tbody></table>` : '';
    setView(`<button class="back" data-back="meetings">‹ 講義ノートへ戻る</button><section class="page-title"><h1>研修のおさらい</h1></section><div class="chip-row">${dates.map((d) => `<button class="chip ${d === state.reviewDate ? 'selected' : ''}" data-review-date="${esc(d)}">${d === 'すべて' ? 'すべての日' : jpDate(d)}</button>`).join('')}</div>`
      + (impHtml ? `<section class="detail-section" id="rv-imp"><h2>重要ポイント</h2><p class="hint">押すと説明と図が開きます</p>${impHtml}</section>` : '')
      + fold('覚える数値', nums.length, numHtml)
      + fold('宿題・次回の連絡', hw.length, bullets(hw))
      + fold('講義ノート', list.length, list.map(meetingCard).join(''), true));
  }
  function jumpTo(date, time) {
    if (!state.data.daily_detail?.[date]) return;
    detail(date); state.tab = 'transcripts'; renderTab();
    setTimeout(() => { const rows = [...document.querySelectorAll('.utterance[data-t]')]; const hit = rows.find((r) => r.dataset.t >= time) || rows[rows.length - 1]; if (hit) { hit.classList.add('flash'); hit.scrollIntoView({ behavior: 'auto', block: 'center' }); } }, 50);
  }
  function frameStrip(d, s) { const thumbs = d.thumbs || {}; const okImg = (v) => /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+\/=]+$/.test(String(v || ''));  // 画像以外の値が来ても属性に混ざらないように
    const imgs = arr(s.frames).filter((f) => okImg(thumbs[f])).map((f) => `<img src="${thumbs[f]}" alt="${esc(f.slice(0,2))}:${esc(f.slice(2,4))} のコマ" loading="lazy">`).join(''); if (!imgs && !s.scene_note) return ''; return `<div class="frame-strip">${imgs}</div>${s.scene_note ? `<p class="scene-note">映像: ${esc(s.scene_note)}</p>` : ''}`; }
  function sessions(d) { return arr(d.sessions).length ? `<div class="timeline">${arr(d.sessions).map((s) => { const sum = sentences(s.summary); const more = lineList(sum.slice(1)) + bullets(s.points); return `<article class="session-card"><span>${esc(s.time)}${s.place ? `<small>${esc(s.place)}</small>` : ''}</span><div><b>${esc(s.title||'会話')}</b><p class="who">${arr(s.participants).map((x) => esc(speaker(x))).join('、')}</p>${sum[0] ? `<p>${esc(sum[0])}</p>` : ''}${more ? `<details class="more-text"><summary>詳しく</summary>${more}</details>` : ''}${frameStrip(d, s)}<button class="text-button" data-session="${esc(String(s.id))}">文字起こしを読む</button></div></article>`; }).join('')}</div>` : empty('会話記録はありません'); }
  function materialsSection(list) { const items = arr(list); return items.length ? fold('配布資料', items.length, items.map((m) => `<article class="meeting-card material"><b>${esc(m.name)}</b>${m.excerpt ? `<p>${esc(m.excerpt)}${Number(m.chars) > 600 ? '…' : ''}</p>` : '<p class="muted">本文を取り出せませんでした</p>'}</article>`).join('')) : ''; }
  function transcripts(d) { const rows = arr(state.data.transcripts?.[state.day]); if (!rows.length) return empty('この日の文字起こしはありません'); const titles = new Map(arr(d.sessions).map((s) => [String(s.id),s.title])); let previous = ''; return rows.map((r) => { const id = String(r.session), title = id !== previous ? `<h2 id="session-${esc(id)}" class="transcript-session">${esc(titles.get(id)||`会話 ${id}`)}</h2>` : ''; previous=id; return `${title}<article class="utterance" data-t="${esc(r.start||'')}"><span class="avatar" style="--hue:${speakerHue(r.speaker)}">${esc(avatarText(speaker(r.speaker)))}</span><div><b>${esc(speaker(r.speaker))}</b><time>${esc(r.start||'')}</time><p>${esc(r.text)}</p></div></article>`; }).join(''); }
  // 文字起こしの丸アイコンの文字。名前未設定の人は全員「未」になって見分けがつかないので、声紋IDの番号を出す
  function avatarText(name) {
    const text = String(name || '');
    const unset = text.match(/^未設定\s*P?0*(\d+)/);
    if (unset) return unset[1].slice(-3);
    const label = text.match(/^P0*(\d+)$/);
    return label ? label[1].slice(-3) : text.slice(0, 1);
  }

  // 状態・重大度を色分けするためのクラス名（日本語の値をそのままクラスにしない）
  function statusClass(status) {
    return { '未着手': 'st-todo', '要確認': 'st-review', '進行中': 'st-doing', '待ち': 'st-review',
             '保留': 'st-hold', '完了': 'st-done', '却下': 'st-rejected', '流れた': 'st-rejected' }[status] || 'st-hold';
  }
  function sevClass(severity) {
    return { '高': 'sev-high', '中': 'sev-mid', '低': 'sev-low' }[severity] || 'sev-low';
  }

  // 話者ごとに色を固定する（同じ声紋IDなら毎回同じ色）
  function speakerHue(label) {
    let h = 0;
    for (const ch of String(label || '')) h = (h * 31 + ch.codePointAt(0)) % 360;
    return h;
  }

  // ナレッジ用の最小限のMarkdown表示（見出し・箇条書き・引用・太字）。先にエスケープしてから整形する
  function markdown(text) {
    const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    let html = '', list = false, quote = false;
    const close = () => {
      if (list) { html += '</ul>'; list = false; }
      if (quote) { html += '</blockquote>'; quote = false; }
    };
    for (const line of String(text || '').split('\n')) {
      const h = line.match(/^(#{1,3})\s+(.*)$/), li = line.match(/^\s*[-*]\s+(.*)$/), q = line.match(/^>\s?(.*)$/);
      if (h) { close(); html += `<h${h[1].length + 1}>${inline(h[2])}</h${h[1].length + 1}>`; }
      else if (li) { if (quote) close(); if (!list) { html += '<ul>'; list = true; } html += `<li>${inline(li[1])}</li>`; }
      else if (q) { if (list) close(); if (!quote) { html += '<blockquote>'; quote = true; } html += `${inline(q[1])}<br>`; }
      else if (!line.trim()) close();
      else { close(); html += `<p>${inline(line)}</p>`; }
    }
    close();
    return html;
  }

  // mermaid の図形記法（root((…)), (…), […], {{…}}, ))…(( など）を外して見出しの文字だけにする
  function mindmapLabel(line) {
    return line.trim()
      .replace(/^[-*]\s*/, '')
      .replace(/^root(?=[(\[{)])/, '')
      .replace(/^[(\[{)]+\s*(.*?)\s*[)\]}(]+$/, '$1');
  }

  function mindmap(d) { const nodes=String(d.mindmap||'').split('\n').filter((x)=>x.trim()&&!/^mindmap\s*$/i.test(x.trim())); return nodes.length ? `<div class="mindmap-tree">${nodes.map((x) => { const depth=Math.floor((x.match(/^\s*/)||[''])[0].length/2); return `<details class="mind-node" open style="--depth:${Math.min(depth,8)}"><summary>${esc(mindmapLabel(x))}</summary></details>`; }).join('')}</div>` : empty('マインドマップはありません'); }
  function detail(day) { const d=state.data.daily_detail?.[day]; if(!d)return; state.day=day; state.tab='summary'; const s=d.stats||{}; setView(`<button class="back" data-back="home">‹ 録音一覧へ戻る</button><section class="page-title day-head">${stamp(day, true)}<div><h1>${jpDate(day)}</h1>${d.tone ? `<p>調子 ${esc(d.tone)}</p>` : ''}</div></section><div class="stat-row"><span>録音<b>${Math.round(Number(s.recorded_min)||0)}</b>分</span><span>発話<b>${Math.round(Number(s.speech_min)||0)}</b>分</span><span>会話<b>${Number(s.sessions)||0}</b></span></div><div class="segments"><button data-tab="summary" class="active">要約</button><button data-tab="sessions">会話</button><button data-tab="transcripts">文字起こし</button><button data-tab="mindmap">要点の木</button></div><div id="detailContent"></div>`); renderTab(); }
  function renderTab() { const d=state.data.daily_detail?.[state.day]; if(!d)return; document.querySelectorAll('[data-tab]').forEach((b)=>b.classList.toggle('active',b.dataset.tab===state.tab)); $('#detailContent').innerHTML=state.tab==='summary'?summary(d):state.tab==='sessions'?sessions(d):state.tab==='transcripts'?transcripts(d):mindmap(d); bind(); }
  // シートの中身を差し込んだ直後にbind()し直す。これが無いと、状態の絞り込みや
  // 「記憶を消す」など、シート内のボタンがクリックしても何も起きない
  function openSheet(html) { $('#sheet').innerHTML=html; $('#sheetBack').classList.add('show'); $('#sheet').classList.add('show'); bind(); }
  function closeSheet() { $('#sheetBack').classList.remove('show'); $('#sheet').classList.remove('show'); }
  function search() { openSheet('<h2>検索</h2><input id="searchInput" placeholder="要約・文字起こし・タスク・人物を検索"><div id="results" class="muted">キーワードを入力してください</div>'); const input=$('#searchInput'); input.focus(); input.oninput=()=>{const q=input.value.trim().toLowerCase();if(!q){$('#results').textContent='キーワードを入力してください';return;}const out=[];const add=(type,title,sub,action,value)=>{if(`${title} ${sub}`.toLowerCase().includes(q))out.push(`<button class="result" data-result="${action}" data-value="${esc(value)}"><b>${esc(type)}　${esc(title)}</b><span>${esc(sub||'')}</span></button>`);};arr(state.data.daily).forEach((x)=>add('日別',x.date,x.summary,'day',x.date));arr(state.data.tasks).forEach((x)=>add('タスク',x.title,x.quote,'page','tasks'));arr(state.data.people).forEach((x)=>add('人物',x.name,x.memo,'person',x.id));arr(state.data.meetings).forEach((x)=>add('議事録',x.title,`${x.date} ${x.purpose||''} ${arr(x.agenda).map((a)=>a.topic).join(' ')} ${arr(x.decisions).join(' ')}`,'meeting',x.id));Object.entries(state.data.transcripts||{}).forEach(([day,rows])=>arr(rows).forEach((r)=>add('文字起こし',speaker(r.speaker),r.text,'day',day)));$('#results').innerHTML=out.slice(0,40).join('')||'<p class="muted">一致する記録はありません</p>';bind();}; }
  function settings() { openSheet('<h2>設定</h2><p class="muted">この端末に保存した合言葉の鍵を消します。次回は合言葉の入力が必要です。</p><button class="danger" data-action="forget">この端末の記憶を消す</button>'); }
  function render() { document.querySelectorAll('.bottom-nav button').forEach((b)=>b.classList.toggle('active',b.dataset.page===state.page)); ({home,tasks,people,meetings,more}[state.page]||home)(); }
  function bind() { document.querySelectorAll('[data-page]').forEach((b)=>b.onclick=()=>{state.page=b.dataset.page;render();});document.querySelectorAll('[data-day]').forEach((b)=>b.onclick=()=>detail(b.dataset.day));document.querySelectorAll('[data-person]').forEach((b)=>b.onclick=()=>personDetail(b.dataset.person));document.querySelectorAll('[data-back]').forEach((b)=>b.onclick=()=>{state.page=b.dataset.back;render();});document.querySelectorAll('[data-tab]').forEach((b)=>b.onclick=()=>{state.tab=b.dataset.tab;renderTab();});document.querySelectorAll('[data-session]').forEach((b)=>b.onclick=()=>{state.tab='transcripts';renderTab();setTimeout(()=>document.querySelector(`#session-${CSS.escape(b.dataset.session)}`)?.scrollIntoView({behavior:'smooth'}),0);});document.querySelectorAll('[data-action="search"]').forEach((b)=>b.onclick=search);document.querySelectorAll('[data-action="filter"]').forEach((b)=>b.onclick=()=>openSheet(`<h2>状態で絞り込む</h2>${['未完了','未着手','要確認','進行中','完了','却下','すべて'].map((x)=>`<button class="sheet-choice ${x===state.taskFilter?'selected':''}" data-filter="${x}">${x}</button>`).join('')}`));document.querySelectorAll('[data-filter]').forEach((b)=>b.onclick=()=>{state.taskFilter=b.dataset.filter;closeSheet();tasks();});document.querySelectorAll('[data-action="threads"]').forEach((b)=>b.onclick=threads);document.querySelectorAll('[data-action="knowledge"]').forEach((b)=>b.onclick=knowledge);document.querySelectorAll('[data-action="settings"]').forEach((b)=>b.onclick=settings);document.querySelectorAll('[data-knowledge]').forEach((b)=>b.onclick=()=>knowledgeDetail(Number(b.dataset.knowledge)));document.querySelectorAll('[data-meeting]').forEach((b)=>b.onclick=()=>meetingDetail(b.dataset.meeting));document.querySelectorAll('[data-mtab]').forEach((b)=>b.onclick=()=>{state.meetingTab=b.dataset.mtab;meetings();});document.querySelectorAll('[data-meeting-filter]').forEach((b)=>b.onclick=()=>{state.meetingFilter=b.dataset.meetingFilter;meetings();});document.querySelectorAll('[data-result]').forEach((b)=>b.onclick=()=>{closeSheet();if(b.dataset.result==='day')detail(b.dataset.value);else if(b.dataset.result==='person')personDetail(b.dataset.value);else if(b.dataset.result==='meeting')meetingDetail(b.dataset.value);else{state.page=b.dataset.value;render();}});document.querySelectorAll('details.quiz').forEach((d)=>d.ontoggle=()=>{if(d.open)loadSlides();});document.querySelectorAll('[data-slide]').forEach((b)=>b.onclick=(e)=>{e.stopPropagation();openSlide(b.dataset.slide);});loadSlides();document.querySelectorAll('[data-action="review"]').forEach((b)=>b.onclick=review);document.querySelectorAll('[data-review-date]').forEach((b)=>b.onclick=()=>{state.reviewDate=b.dataset.reviewDate;review();});document.querySelectorAll('[data-jump]').forEach((b)=>b.onclick=(e)=>{e.stopPropagation();const [d,t]=b.dataset.jump.split('|');jumpTo(d,t);});document.querySelectorAll('[data-scroll]').forEach((b)=>b.onclick=()=>{const el=document.getElementById(b.dataset.scroll);if(!el)return;if(el.tagName==='DETAILS')el.open=true;el.scrollIntoView({behavior:'smooth',block:'start'});});document.querySelectorAll('[data-quiz]').forEach((b)=>b.onclick=()=>startQuiz(state.quizSet));document.querySelectorAll('[data-qz]').forEach((b)=>b.onclick=()=>{const z=state.qz;if(!z)return;const a=b.dataset.qz;if(a==='close'){closeSheet();return;}if(a==='show')z.shown=true;else if(a==='next'){z.i++;z.shown=false;}else if(a==='prev'){z.i=Math.max(0,z.i-1);z.shown=false;}else if(a==='restart'){z.i=0;z.shown=false;}showQuiz();});document.querySelectorAll('details.lec-point,details.fold,details.more-text').forEach((d)=>d.ontoggle=()=>{if(d.open)loadSlides();});document.querySelectorAll('[data-action="forget"]').forEach((b)=>b.onclick=async()=>{await clearKey();location.reload();}); }
  $('#sheetBack').onclick=closeSheet; $('#searchButton').onclick=search; $('#unlockForm').onsubmit=async(e)=>{e.preventDefault();const pass=$('#passphrase').value;if(!pass)return;$('#lockError').textContent='';try{await unlock(pass);$('#passphrase').value='';}catch{$('#lockError').textContent='合言葉が正しくないか、データを開けません。';}}; if('serviceWorker' in navigator)navigator.serviceWorker.register('sw.js').catch(()=>{}); unlock().catch(()=>{});
})();
