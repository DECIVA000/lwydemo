import { createStressDashboard } from './stress-component.5a6b3eba4a.js';

/* Patient education portal. Source is intentionally readable for maintenance. */
export const CONTENT_TIMEOUT_MS = 8000;

export function validContent(value) {
  return !!value && value.schemaVersion === 1 && typeof value.revision === 'string'
    && value.fields && !Array.isArray(value.fields)
    && Object.keys(value.fields).length < 2000
    && Object.entries(value.fields).every(([key, text]) =>
      /^(site|section|animation)\.[a-zA-Z0-9._-]+$/.test(key)
      && typeof text === 'string' && text.length <= 12000);
}

/**
 * Load a complete content revision before it becomes visible. The bundled
 * snapshot remains a fallback; onBaseline prepares navigation/preview context
 * but must not paint that snapshot. One deadline covers bootstrap and cloud.
 */
export async function loadPortalContent({
  baseUrl = new URL('./', location.href), fetchImpl = fetch,
  onBaseline = () => {}, timeoutMs = CONTENT_TIMEOUT_MS,
} = {}) {
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('CONTENT_TIMEOUT'));
    }, timeoutMs);
  });
  const read = (path, cache = 'no-store') => Promise.race([
    Promise.resolve().then(() => fetchImpl(new URL(path, baseUrl), {
      cache, signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer',
    })).then(response => {
      if (!response.ok) throw new Error('CONTENT_UNAVAILABLE');
      return response.json();
    }),
    deadline,
  ]);

  try {
    const [baseline, registry, config, structure] = await Promise.all([
      read('content/published.json'), read('content/registry.json'),
      read('runtime-config.json').catch(() => ({ cloudEnabled: false, unavailable: true })),
      read('content/structure.json'),
    ]);
    if (!validContent(baseline) || !Array.isArray(registry) || !Array.isArray(structure)) {
      throw new Error('INVALID_BASELINE');
    }
    const result = {
      content: baseline, registry, config, structure, cloud: false,
      source: 'bundled', fallback: !!config.unavailable,
    };
    await onBaseline(result);
    if (config.cloudEnabled) {
      try {
        if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(config.publicContentUrl || '')) throw new Error('INVALID_PUBLIC_CONTENT_URL');
        const body = await read(config.publicContentUrl, 'no-cache');
        const content = body.content ?? body.data ?? body;
        if (!validContent(content)) throw new Error('INVALID_CLOUD_CONTENT');
        return { ...result, content, cloud: true, source: 'cloud', fallback: false };
      } catch (_) {
        return { ...result, fallback: true };
      }
    }
    return result;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

/**
 * Coordinates a single visible revision. A valid editor preview wins every
 * race against the cloud request. Preview mode waits for its postMessage
 * handshake instead of briefly showing the public revision first.
 */
export function createContentSession({
  load, apply, finish, fail, previewReady = () => {}, previewMode = false,
  previewTimeoutMs = CONTENT_TIMEOUT_MS,
}) {
  let context;
  let preview;
  let appliedPreview;
  let started = false;
  let previewTimer;
  let releasePreviewWait;
  let previewWaitFinished = false;
  const previewWait = new Promise(resolve => { releasePreviewWait = resolve; });
  const stopWaiting = () => {
    clearTimeout(previewTimer);
    previewWaitFinished = true;
    releasePreviewWait();
  };
  const paint = result => {
    if (apply(result) !== false) finish(result.source);
  };
  const paintPreview = () => {
    if (!context || !preview || preview === appliedPreview) return;
    paint({ ...context, content: preview, source: 'preview', fallback: false });
    appliedPreview = preview;
  };
  return {
    acceptPreview(content) {
      if (!validContent(content)) return false;
      preview = content;
      stopWaiting();
      paintPreview();
      return true;
    },
    async start() {
      if (started) throw new Error('CONTENT_SESSION_ALREADY_STARTED');
      started = true;
      if (previewMode && !previewWaitFinished) {
        previewTimer = setTimeout(stopWaiting, previewTimeoutMs);
      }
      try {
        const result = await load({ onBaseline: baseline => {
          context = baseline;
          paintPreview();
          if (previewMode) previewReady();
        } });
        context = result;
        if (previewMode && !preview && !previewWaitFinished) await previewWait;
        if (preview) paintPreview();
        else paint(result);
        return preview ? 'preview' : result.source;
      } catch (error) {
        if (preview && context) paintPreview();
        else fail(error);
        return preview && context ? 'preview' : 'error';
      } finally {
        stopWaiting();
      }
    },
  };
}

export function allowedPreview(event, token, currentWindow = window) {
  if (!token || event.data?.token !== token || event.data?.type !== 'CONTENT_PREVIEW'
      || !validContent(event.data.content)) return false;
  const parent = currentWindow.parent !== currentWindow ? currentWindow.parent : currentWindow.opener;
  const googleOrigin = /^https:\/\/([a-z0-9-]+-)?script\.googleusercontent\.com$/.test(event.origin);
  return !!parent && event.source === parent
    && (event.origin === currentWindow.location.origin || googleOrigin);
}

export function startPortal() {
  // A failed module download has already exposed the explicit static fallback.
  // Do not start a late network update that would recreate old/new flashing.
  if (document.documentElement.dataset.contentState === 'static-fallback') return;
  const byId = id => document.getElementById(id);
  const previewToken = new URLSearchParams(location.search).get('editorPreview');
  let selected = 0;
  let content;
  let structure = [];
  let registry = [];
  let animationReady = false;
  let pendingAnimationTime;
  let activeTab = 'stress';
  let contentSettled = false;
  let pendingTopic;
  const tabNames = ['stress', 'animation', 'guide'];
  const stressDashboard = createStressDashboard(byId('stress-education-dashboard'));

  function notifyAnimationHost() {
    const frameWindow = byId('animationFrame').contentWindow;
    if (!animationReady || !frameWindow) return;
    const active = contentSettled && activeTab === 'animation'
      && !byId('animationMount').hidden && !document.hidden;
    frameWindow.postMessage({ type: 'CORONARY_HOST_VISIBILITY', active }, location.origin);
  }

  function syncActivity() {
    stressDashboard?.setActive(contentSettled && activeTab === 'stress' && !document.hidden);
    notifyAnimationHost();
  }

  function showTab(name, { updateHistory = false, focus = false, scroll = false, hash } = {}) {
    if (!tabNames.includes(name)) name = 'stress';
    activeTab = name;
    document.documentElement.dataset.activeTab = name;
    for (const tab of tabNames) {
      const selected = name === tab;
      byId(tab).hidden = !selected;
      byId('tab-' + tab).setAttribute('aria-selected', String(selected));
      byId('tab-' + tab).tabIndex = selected ? 0 : -1;
    }
    if (updateHistory) {
      const nextHash = '#' + (hash || name);
      if (location.hash !== nextHash) history.pushState(null, '', nextHash);
    }
    syncActivity();
    if (focus) byId('tab-' + name).focus({ preventScroll: true });
    if (scroll) byId('tabNavigation').scrollIntoView({ block: 'start' });
  }

  function routeFromLocation() {
    let route;
    try { route = decodeURIComponent(location.hash.slice(1)); } catch (_) { route = ''; }
    const [part, topic] = route.split('/');
    const name = part === 'doctor' ? 'guide' : tabNames.includes(part) ? part : 'stress';
    pendingTopic = part === 'doctor' ? 'doctor' : name === 'guide' ? topic : undefined;
    showTab(name);
    if (pendingTopic && structure.length) {
      const index = structure.findIndex(item => item.id === pendingTopic);
      if (index >= 0) selectTopic(index);
      pendingTopic = undefined;
    }
  }
  const field = key => content?.fields?.[key]
    ?? registry.find(entry => entry.key === key)?.defaultValue ?? '';
  const element = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };

  function contentBlock(block) {
    const section = element('section', undefined, 'content-block ' + (block.tone ?? ''));
    if (block.title) section.append(element('h4', field(block.title)));
    if (block.text) section.append(element('p', field(block.text)));
    if (block.items) {
      const list = element('ul');
      for (const key of block.items) list.append(element('li', field(key)));
      section.append(list);
    }
    return section;
  }

  function renderCard() {
    const topic = structure[selected];
    if (!topic) return;
    const card = byId('educationCard');
    card.replaceChildren();
    card.append(
      element('span', String(selected + 1).padStart(2, '0') + ' / ' + String(structure.length).padStart(2, '0'), 'card-number'),
      element('h3', field(topic.title)), element('p', field(topic.summary), 'card-summary'),
    );
    for (const block of topic.blocks) card.append(contentBlock(block));
    if (topic.animation !== null) {
      const button = element('button', '▶  ' + field('site.openAnimation'), 'inline-animation');
      button.onclick = () => openAnimation(topic.animation);
      card.append(button);
    }
    byId('position').textContent = String(selected + 1).padStart(2, '0');
    for (const id of ['topicNav', 'cardDots']) {
      byId(id).querySelectorAll('button').forEach((button, index) =>
        button.setAttribute('aria-current', String(selected === index)));
    }
    byId('previous').disabled = selected === 0;
    byId('next').disabled = selected === structure.length - 1;
  }

  function selectTopic(index, scroll = false) {
    selected = Math.max(0, Math.min(structure.length - 1, index));
    renderCard();
    if (scroll) showTab('guide', {
      updateHistory: true, scroll: true,
      hash: 'guide/' + (structure[selected]?.id || ''),
    });
  }

  function updateAnimation(time) {
    const frameWindow = byId('animationFrame').contentWindow;
    if (!animationReady || !frameWindow || !content) return;
    frameWindow.postMessage({
      type: 'CORONARY_CONTENT', content,
      ...(time !== undefined ? { time } : {}),
    }, location.origin);
  }

  function openAnimation(time) {
    showTab('animation', { updateHistory: true, scroll: true });
    byId('animationPoster').hidden = true;
    byId('animationMount').hidden = false;
    const frame = byId('animationFrame');
    if (Number.isFinite(time)) pendingAnimationTime = time;
    if (frame.getAttribute('src')) {
      if (animationReady && pendingAnimationTime !== undefined) {
        updateAnimation(pendingAnimationTime);
        pendingAnimationTime = undefined;
      }
      notifyAnimationHost();
    } else {
      animationReady = false;
      const initialTime = pendingAnimationTime ?? 0;
      frame.onload = () => {
        animationReady = true;
        updateAnimation(pendingAnimationTime);
        pendingAnimationTime = undefined;
        notifyAnimationHost();
      };
      frame.src = 'animation/?embedded=1&t=' + initialTime;
    }
  }

  function render() {
    document.querySelectorAll('[data-key]').forEach(node => { node.textContent = field(node.dataset.key); });
    document.title = field('site.brand');
    for (const [dataAttribute, attribute] of [
      ['data-aria-key', 'aria-label'], ['data-alt-key', 'alt'],
      ['data-title-key', 'title'], ['data-content-key', 'content'],
    ]) {
      document.querySelectorAll('[' + dataAttribute + ']').forEach(node =>
        node.setAttribute(attribute, field(node.getAttribute(dataAttribute))));
    }
    stressDashboard?.updateContent(field);
    if (pendingTopic) {
      const index = structure.findIndex(item => item.id === pendingTopic);
      if (index >= 0) selected = index;
      pendingTopic = undefined;
    }
    byId('topicNav').replaceChildren();
    byId('cardDots').replaceChildren();
    byId('printContent').replaceChildren();
    structure.forEach((topic, index) => {
      const button = element('button');
      button.append(element('b', String(index + 1).padStart(2, '0')), element('span', field(topic.title)));
      button.onclick = () => selectTopic(index);
      byId('topicNav').append(button);
      const dot = element('button');
      dot.setAttribute('aria-label', field(topic.title));
      dot.onclick = () => selectTopic(index);
      byId('cardDots').append(dot);
      const printTopic = element('article');
      printTopic.append(element('h2', field(topic.title)), element('p', field(topic.summary)));
      topic.blocks.forEach(block => printTopic.append(contentBlock(block)));
      byId('printContent').append(printTopic);
    });
    byId('contentVersion').textContent = field('site.published') + ' '
      + (content.revision.startsWith('v8-review') ? '08・預覽' : content.revision.slice(0, 12));
    renderCard();
    updateAnimation();
  }

  function finish(state) {
    document.documentElement.dataset.contentState = state;
    document.documentElement.classList.remove('content-pending');
    document.querySelectorAll('[data-content-shell]').forEach(node => node.removeAttribute('aria-busy'));
    byId('contentLoading').hidden = true;
    contentSettled = true;
    syncActivity();
    document.dispatchEvent(new Event('portal-content-settled'));
  }

  const session = createContentSession({
    previewMode: !!previewToken,
    load: options => loadPortalContent(options),
    previewReady: () => {
      const parent = window.parent !== window ? window.parent : window.opener;
      if (parent) parent.postMessage({ type: 'PREVIEW_READY', token: previewToken }, '*');
    },
    apply: result => {
      // The inline watchdog may already have presented an explicit fallback.
      // A late background response must not replace it unexpectedly.
      if (document.documentElement.dataset.contentState === 'static-fallback'
          && result.source !== 'preview') return false;
      content = result.content;
      registry = result.registry;
      structure = result.structure;
      byId('previewBanner').hidden = result.source !== 'preview';
      byId('contentNotice').hidden = !result.fallback;
      if (result.fallback) byId('contentNotice').textContent = field('site.contentFallback');
      render();
    },
    finish,
    fail: error => {
      byId('educationCard').textContent = '衛教內容暫時無法載入，請重新整理後再試。';
      byId('contentNotice').textContent = '目前顯示網站內附的備用文字；最新內容暫時無法取得，請稍後重新整理。';
      byId('contentNotice').hidden = false;
      finish('static-fallback');
      console.error('Unable to load patient education content', error);
    },
  });

  document.querySelectorAll('[data-content-shell]').forEach(node => node.setAttribute('aria-busy', 'true'));
  document.querySelectorAll('[data-open-animation]').forEach(node =>
    node.addEventListener('click', event => {
      event.preventDefault();
      openAnimation(node.dataset.openAnimation === 'resume' ? undefined : Number(node.dataset.openAnimation));
    }));
  document.querySelectorAll('[data-select-topic]').forEach(node =>
    node.addEventListener('click', event => {
      event.preventDefault();
      selectTopic(structure.findIndex(topic => topic.id === node.dataset.selectTopic), true);
    }));
  byId('previous').onclick = () => selectTopic(selected - 1);
  byId('next').onclick = () => selectTopic(selected + 1);
  byId('closeAnimation').onclick = () => {
    byId('animationMount').hidden = true;
    byId('animationPoster').hidden = false;
    notifyAnimationHost();
  };
  byId('printButton').onclick = () => window.print();
  document.querySelectorAll('[data-tab]').forEach(button => {
    button.addEventListener('click', () => showTab(button.dataset.tab, { updateHistory: true, scroll: true }));
    button.addEventListener('keydown', event => {
      const current = tabNames.indexOf(button.dataset.tab);
      let next;
      if (event.key === 'ArrowRight') next = (current + 1) % tabNames.length;
      if (event.key === 'ArrowLeft') next = (current - 1 + tabNames.length) % tabNames.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = tabNames.length - 1;
      if (next === undefined) return;
      event.preventDefault();
      showTab(tabNames[next], { updateHistory: true, focus: true });
    });
  });
  document.querySelectorAll('a[href^="#"]').forEach(link => {
    if (link.hasAttribute('data-open-animation') || link.hasAttribute('data-select-topic')) return;
    link.addEventListener('click', event => {
      const hash = link.getAttribute('href').slice(1);
      const tab = hash === 'top' ? 'stress' : hash;
      if (!tabNames.includes(tab)) return;
      event.preventDefault();
      showTab(tab, { updateHistory: true, scroll: true });
    });
  });
  window.addEventListener('hashchange', routeFromLocation);
  window.addEventListener('popstate', routeFromLocation);
  document.addEventListener('visibilitychange', syncActivity);
  let touch;
  byId('educationCard').addEventListener('touchstart', event => {
    if (event.touches.length === 1) touch = { x: event.touches[0].clientX, y: event.touches[0].clientY };
  }, { passive: true });
  byId('educationCard').addEventListener('touchend', event => {
    if (!touch) return;
    const x = event.changedTouches[0].clientX - touch.x;
    const y = event.changedTouches[0].clientY - touch.y;
    if (Math.abs(x) > 65 && Math.abs(x) > Math.abs(y) * 1.4) selectTopic(selected + (x < 0 ? 1 : -1));
    touch = null;
  }, { passive: true });
  byId('guide').addEventListener('keydown', event => {
    if (event.target.closest('input,textarea,select')) return;
    if (event.key === 'ArrowRight') { event.preventDefault(); selectTopic(selected + 1); }
    if (event.key === 'ArrowLeft') { event.preventDefault(); selectTopic(selected - 1); }
  });
  window.addEventListener('message', event => {
    if (allowedPreview(event, previewToken)) session.acceptPreview(event.data.content);
    if (event.origin === location.origin && event.source === byId('animationFrame').contentWindow
        && event.data?.type === 'CORONARY_HOST_READY') {
      animationReady = true;
      updateAnimation(pendingAnimationTime);
      pendingAnimationTime = undefined;
      notifyAnimationHost();
    }
    if (event.origin === location.origin && event.source === byId('animationFrame').contentWindow
        && event.data?.type === 'CORONARY_HEIGHT') {
      byId('animationFrame').style.height = Math.min(2200, Math.max(650, event.data.height)) + 'px';
    }
  });
  routeFromLocation();
  session.start();
  return session;
}

if (typeof document !== 'undefined') startPortal();
