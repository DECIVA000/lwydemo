/* Approved stress dashboard, integrated with the shared content session. */
const DEFAULT_TEXT = {
  "flow.inlet": "血液流入",
  "branch.normal": "正常分支",
  "branch.diseasedShort": "狹窄分支",
  "branch.diseased": "有病灶的分支",
  "flow.limitedShort": "增加有限",
  "flow.increasedShort": "血流增加",
  "flow.dilatedShort": "末端已擴張",
  "flow.restShort": "休息血流",
  "plaque.short": "狹窄",
  "flow.limited": "仍有血流，但增加有限",
  "flow.increased": "小血管擴張・血流增加",
  "flow.dilated": "末端已擴張・仍有血流",
  "flow.rest": "休息狀態的血流",
  "plaque.label": "斑塊造成狹窄",
  "motion.pause": "暫停動畫",
  "motion.play": "播放動畫",
  "motion.pauseLabel": "暫停紅血球流動動畫",
  "motion.playLabel": "播放紅血球流動動畫",
  "diagram.exerciseNote": "運動時，心肌需要更多氧氣。",
  "diagram.nuclearNote": "以下以擴血管藥物示意。",
  "state.stress": "壓力下",
  "state.rest": "休息時",
  "result.restTitle": "休息時足夠，不代表壓力下也足夠。",
  "result.exerciseRest": "加入壓力，看看正常分支和狹窄分支的血流，會有什麼不同。",
  "result.nuclearRest": "藥物讓末端小血管擴張，用來觀察各區域增加血流的能力。",
  "result.exerciseStressTitle": "心臟更忙，狹窄區的供血可能跟不上。",
  "result.exerciseStress": "正常區血流明顯增加；狹窄區仍有血流，但增加幅度不足以滿足運動時的需要。",
  "result.nuclearStressTitle": "正常區增流明顯，狹窄區的增幅有限。",
  "result.nuclearStress": "核醫影像比較休息與壓力下的灌流分布，找出相對血流較少的區域。"
};

export function createStressDashboard(root) {
  if (!root || root.dataset.initialized === 'true') return null;
  root.dataset.initialized = 'true';
  const q = selector => root.querySelector(selector);
  const qa = selector => Array.from(root.querySelectorAll(selector));
  const svg = q('.se-diagram');
  const walls = q('[data-vessel-walls]');
  const lumens = q('[data-vessel-lumens]');
  const plaque = q('[data-vessel-plaque]');
  const labels = q('[data-vessel-labels]');
  const background = q('[data-vessel-background]');
  const blood = q('[data-blood-cells]');
  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  let exam = 'exercise';
  let stressed = false;
  let pressure = 0;
  let playing = !motionQuery.matches;
  let frame = 0;
  let previousTime = 0;
  let destroyed = false;
  let inView = true;
  let active = false;
  let fieldResolver;
  const t = name => {
    const key = 'section.stress.' + name;
    const resolved = fieldResolver?.(key);
    return typeof resolved === 'string' ? resolved : DEFAULT_TEXT[name] ?? '';
  };
  let width = 0;
  let mobile = false;
  let trunkLength = 0;
  let branchPaths = [];
  let wallNodes = [];
  let lumenNodes = [];
  let particles = [];
  let spawnCarry = [.05, .37, .69];
  let nextGroup = 0;
  let geometry = null;
  const NS = 'http://www.w3.org/2000/svg';
  const colors = {ink:'#173338',muted:'#687c7d',teal:'#39746d',wall:'#8eafa1',lumen:'#e8f0e3',gold:'#e3bf87',goldInk:'#865e31',red:'#b75c5e',redInner:'#dc9d8a'};

  function el(name, attrs, parent, text) {
    const node = document.createElementNS(NS, name);
    Object.entries(attrs || {}).forEach(([key, value]) => node.setAttribute(key, String(value)));
    if (text !== undefined) node.textContent = text;
    if (parent) parent.appendChild(node);
    return node;
  }

  function label(x, y, text, options = {}) {
    return el('text', {x, y, fill:options.color || colors.ink, 'font-size':options.size || 13, 'font-weight':options.weight || 400, 'text-anchor':options.anchor || 'start', ...options.attrs}, labels, text);
  }

  function makeGeometry(w, small) {
    const h = small ? 340 : 282;
    if (small) {
      const cx = w / 2;
      const jy = 100;
      const endY = 252;
      const spread = Math.max(65, Math.min(105, w * .31));
      const ends = [cx - spread, cx, cx + spread];
      const trunk = `M ${cx} 28 L ${cx} ${jy}`;
      const branches = ends.map((x, i) => i === 1 ? `M ${cx} ${jy} L ${cx} ${endY}` : `M ${cx} ${jy} C ${cx} 157 ${x} 160 ${x} ${endY}`);
      return {w,h,small,cx,jy,endY,ends,trunk,branches,plaqueX:cx,plaqueY:177,plaqueDistance:149};
    }
    const cy = 141;
    const jx = Math.min(170, w * .225);
    const endX = w - 167;
    const ends = [54,cy,228];
    const trunk = `M 35 ${cy} L ${jx} ${cy}`;
    const branches = ends.map((y, i) => i === 1 ? `M ${jx} ${cy} L ${endX} ${cy}` : `M ${jx} ${cy} C ${jx + 70} ${cy} ${jx + 88} ${y} ${endX} ${y}`);
    const px = jx + (endX - jx) * .45;
    return {w,h,small,cy,jx,endX,ends,trunk,branches,plaqueX:px,plaqueY:cy,plaqueDistance:px - 35};
  }

  function renderLabels() {
    labels.replaceChildren();
    if (!geometry) return;
    const g = geometry;
    if (g.small) {
      label(g.cx + 34, 39, t('flow.inlet'), {size:12,color:colors.muted});
      const names = [t('branch.normal'), t('branch.diseasedShort'), t('branch.normal')];
      g.ends.forEach((x, i) => {
        label(x, 292, names[i], {size:13,weight:600,anchor:'middle',color:i === 1 ? colors.goldInk : colors.teal});
        label(x, 312, stressed ? (i === 1 ? t('flow.limitedShort') : t('flow.increasedShort')) : (i === 1 ? t('flow.dilatedShort') : t('flow.restShort')), {size:11,anchor:'middle',color:colors.muted});
      });
      label(g.plaqueX + 23, g.plaqueY + 49, t('plaque.short'), {size:11,color:colors.goldInk});
      el('path',{d:`M ${g.plaqueX + 14} ${g.plaqueY + 18} L ${g.plaqueX + 19} ${g.plaqueY + 39}`,stroke:'#bf9d6d','stroke-width':1,fill:'none'},labels);
    } else {
      label(35, 94, t('flow.inlet'), {size:12,color:colors.muted});
      const names = [t('branch.normal'), t('branch.diseased'), t('branch.normal')];
      g.ends.forEach((y, i) => {
        label(g.endX + 36, y - 5, names[i], {size:14,weight:600,color:i === 1 ? colors.goldInk : colors.teal});
        label(g.endX + 36, y + 16, stressed ? (i === 1 ? t('flow.limited') : t('flow.increased')) : (i === 1 ? t('flow.dilated') : t('flow.rest')), {size:11,color:colors.muted});
      });
      label(g.plaqueX + 42, g.cy - 29, t('plaque.label'), {size:11,color:colors.goldInk});
      el('path',{d:`M ${g.plaqueX} ${g.cy - 18} L ${g.plaqueX + 32} ${g.cy - 29}`,stroke:'#bf9d6d','stroke-width':1,fill:'none'},labels);
    }
  }

  function drawVessels() {
    if (!geometry) return;
    const normal = (mobile ? 16 : 20) + pressure * (mobile ? 22 : 30);
    const diseased = mobile ? 27 : 32;
    const widths = [normal, diseased, normal];
    wallNodes.forEach((node, i) => node.setAttribute('stroke-width', widths[i] + 5));
    lumenNodes.forEach((node, i) => node.setAttribute('stroke-width', widths[i]));
    const zones = background.querySelectorAll('[data-zone]');
    zones.forEach((node, i) => node.setAttribute('opacity', stressed && i === 1 ? '.55' : stressed ? '.95' : '.38'));
    root.dataset.stressState = stressed ? 'stress' : 'rest';
    root.dataset.exam = exam;
  }

  function resize() {
    if (destroyed || !root.isConnected || root.getBoundingClientRect().width === 0) return;
    const nextWidth = Math.max(240, Math.round(svg.getBoundingClientRect().width));
    const nextMobile = nextWidth < 540;
    if (Math.abs(nextWidth - width) < 1 && mobile === nextMobile && geometry) return;
    width = nextWidth;
    mobile = nextMobile;
    geometry = makeGeometry(width, mobile);
    svg.style.height = geometry.h + 'px';
    svg.setAttribute('viewBox', `0 0 ${width} ${geometry.h}`);
    walls.replaceChildren(); lumens.replaceChildren(); plaque.replaceChildren(); background.replaceChildren();
    const g = geometry;
    if (mobile) {
      g.ends.forEach((x, i) => el('ellipse',{cx:x,cy:250,rx:25,ry:18,fill:i === 1 ? '#efe3cc' : '#e5eee1',opacity:'.38','data-zone':i},background));
    } else {
      g.ends.forEach((y, i) => el('ellipse',{cx:g.endX,cy:y,rx:28,ry:27,fill:i === 1 ? '#efe3cc' : '#e5eee1',opacity:'.38','data-zone':i},background));
    }
    el('path',{d:g.trunk,stroke:colors.wall,'stroke-width':mobile ? 40 : 45,'stroke-linecap':'round',fill:'none'},walls);
    wallNodes = g.branches.map(d => el('path',{d,stroke:colors.wall,'stroke-width':26,'stroke-linecap':'round',fill:'none'},walls));
    el('path',{d:g.trunk,stroke:colors.lumen,'stroke-width':mobile ? 35 : 40,'stroke-linecap':'round',fill:'none'},lumens);
    lumenNodes = g.branches.map((d, i) => el('path',{d,stroke:colors.lumen,'stroke-width':20,'stroke-linecap':'round',fill:'none','data-lumen-branch':i},lumens));
    const trunkPath = el('path',{d:g.trunk,fill:'none',stroke:'none'},lumens);
    trunkLength = trunkPath.getTotalLength();
    branchPaths = g.branches.map((d, i) => {
      const combined = g.trunk + ' ' + d.replace(/^M[^CL]+/, '');
      const node = el('path',{d:combined,fill:'none',stroke:'none','data-flow-path':i},lumens);
      return {node,length:node.getTotalLength()};
    });
    const px = g.plaqueX, py = g.plaqueY;
    const half = mobile ? 13 : 16;
    if (mobile) {
      el('path',{d:`M ${px - half} ${py - 25} Q ${px + 3} ${py} ${px - half} ${py + 25} Z`,fill:colors.gold,stroke:'#cda86b','stroke-width':.8},plaque);
      el('path',{d:`M ${px + half} ${py - 25} Q ${px - 3} ${py} ${px + half} ${py + 25} Z`,fill:colors.gold,stroke:'#cda86b','stroke-width':.8},plaque);
    } else {
      el('path',{d:`M ${px - 28} ${py - half} Q ${px} ${py + 3} ${px + 28} ${py - half} Z`,fill:colors.gold,stroke:'#cda86b','stroke-width':.8},plaque);
      el('path',{d:`M ${px - 28} ${py + half} Q ${px} ${py - 3} ${px + 28} ${py + half} Z`,fill:colors.gold,stroke:'#cda86b','stroke-width':.8},plaque);
    }
    drawVessels();
    renderLabels();
    seedParticles();
    renderParticles();
  }

  function pulseRate(branch, amount = pressure) {
    return 2.05 + amount * (branch === 1 ? .15 : .65);
  }

  function branchSpeed(branch, amount = pressure) {
    return 75 + amount * (branch === 1 ? 6 : 21);
  }

  function particleLimit(branch) {
    const maxFlow = branch === 1 ? 2.2 : 8.1;
    return Math.ceil(branchPaths[branch].length / 75 * maxFlow) + 12;
  }

  function createParticle(branch, distance, lane, group) {
    const node = el('g',{'data-rbc-branch':branch,'data-rbc-lane':lane},blood);
    el('ellipse',{cx:0,cy:0,rx:mobile ? 4.5 : 5.2,ry:mobile ? 2.5 : 2.9,fill:colors.red},node);
    el('ellipse',{cx:0,cy:0,rx:mobile ? 2.5 : 2.9,ry:mobile ? 1.25 : 1.45,fill:colors.redInner,opacity:'.85'},node);
    const particle = {branch,distance,node,lane,group,jitter:(Math.random() - .5) * 1.2};
    particles.push(particle);
    return particle;
  }

  function createPulse(branch, distance) {
    const group = nextGroup++;
    createParticle(branch,distance,0,group);
    if (stressed && branch !== 1) {
      createParticle(branch,distance,-1,group);
      createParticle(branch,distance,1,group);
    }
  }

  function expandNormalLanes() {
    const existing = new Set(particles.map(particle => `${particle.group}:${particle.lane}`));
    const centers = particles.filter(particle => particle.branch !== 1 && particle.lane === 0);
    centers.forEach(particle => {
      [-1,1].forEach(lane => {
        if (!existing.has(`${particle.group}:${lane}`)) {
          createParticle(particle.branch,particle.distance,lane,particle.group);
        }
      });
    });
  }

  function seedParticles() {
    blood.replaceChildren();
    particles = [];
    spawnCarry = [.05,.37,.69];
    const amount = stressed ? 1 : 0;
    const inletSpeed = 82 + amount * 60;
    const inletTime = trunkLength / inletSpeed;
    branchPaths.forEach((path, branch) => {
      const downstreamSpeed = branchSpeed(branch,amount);
      const travelTime = inletTime + (path.length - trunkLength) / downstreamSpeed;
      const count = Math.max(4,Math.ceil(travelTime * pulseRate(branch,amount)));
      for (let i = 0; i < count; i++) {
        const age = travelTime * ((i + .25 + branch * .18) / count);
        const distance = age < inletTime ? age * inletSpeed : trunkLength + (age - inletTime) * downstreamSpeed;
        createPulse(branch,distance);
      }
    });
  }

  function placeParticle(particle) {
    const path = branchPaths[particle.branch];
    if (!path) return;
    const d = Math.max(0, Math.min(path.length, particle.distance));
    const point = path.node.getPointAtLength(d);
    const prior = path.node.getPointAtLength(Math.max(0,d - .5));
    const next = path.node.getPointAtLength(Math.min(path.length,d + .5));
    const angle = Math.atan2(next.y - prior.y, next.x - prior.x);
    const inletOffset = particle.branch === 1 ? particle.jitter : (particle.branch === 0 ? -7 : 7) + particle.lane * (mobile ? 5.8 : 6.6) * pressure + particle.jitter * .6;
    const downstreamOffset = particle.branch === 1 ? particle.jitter : particle.lane * (mobile ? 10.5 : 14) * pressure + particle.jitter;
    const junctionBlend = Math.max(0,Math.min(1,(d - trunkLength + 10) / 30));
    let offset = inletOffset * (1 - junctionBlend) + downstreamOffset * junctionBlend;
    if (particle.branch === 1) {
      const nearPlaque = Math.max(0, 1 - Math.abs(d - geometry.plaqueDistance) / 38);
      offset *= 1 - nearPlaque * .85;
    }
    const x = point.x - Math.sin(angle) * offset;
    const y = point.y + Math.cos(angle) * offset;
    particle.node.setAttribute('transform', `translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${(angle * 180 / Math.PI).toFixed(2)})`);
    particle.node.setAttribute('opacity',particle.lane === 0 ? 1 : Math.max(0,Math.min(1,pressure * 1.3)));
  }

  function renderParticles() { particles.forEach(placeParticle); }

  function updateText() {
    qa('[data-exam]').forEach(button => {
      const selected = button.dataset.exam === exam;
      button.setAttribute('aria-pressed',String(selected));
      button.setAttribute('aria-expanded',String(selected));
    });
    qa('[data-exam-panel]').forEach(panel => { panel.hidden = panel.dataset.examPanel !== exam; });
    qa('[data-state-button]').forEach(button => button.setAttribute('aria-pressed', String((button.dataset.stateButton === 'stress') === stressed)));
    q('[data-motion]').setAttribute('aria-pressed', String(!playing));
    q('[data-motion-label]').textContent = playing ? t('motion.pause') : t('motion.play');
    q('.se-motion-symbol').textContent = playing ? 'Ⅱ' : '▷';
    q('[data-motion]').setAttribute('aria-label', playing ? t('motion.pauseLabel') : t('motion.playLabel'));
    q('#sev2-mode-note').textContent = exam === 'exercise' ? t('diagram.exerciseNote') : t('diagram.nuclearNote');
    q('.se-result').dataset.state = stressed ? 'stress' : 'rest';
    q('[data-state-label]').textContent = stressed ? t('state.stress') : t('state.rest');
    if (!stressed) {
      q('[data-result-title]').textContent = t('result.restTitle');
      q('[data-result-copy]').textContent = exam === 'exercise' ? t('result.exerciseRest') : t('result.nuclearRest');
    } else if (exam === 'exercise') {
      q('[data-result-title]').textContent = t('result.exerciseStressTitle');
      q('[data-result-copy]').textContent = t('result.exerciseStress');
    } else {
      q('[data-result-title]').textContent = t('result.nuclearStressTitle');
      q('[data-result-copy]').textContent = t('result.nuclearStress');
    }
    renderLabels();
    root.dataset.exam = exam;
    root.dataset.stressState = stressed ? 'stress' : 'rest';
    root.dataset.animation = playing ? 'playing' : 'paused';
  }

  function setState(value) {
    if (stressed === value) return;
    stressed = value;
    updateText();
    q('[data-announcement]').textContent = `${q('[data-state-label]').textContent}，${q('[data-result-title]').textContent}${q('[data-result-copy]').textContent}`;
    if (!active || !playing || document.hidden || !inView) {
      pressure = stressed ? 1 : 0;
      drawVessels();
      seedParticles();
      renderParticles();
    } else if (stressed) {
      expandNormalLanes();
      renderParticles();
    }
    start();
  }

  function settleScene() {
    pressure = stressed ? 1 : 0;
    if (stressed) expandNormalLanes();
    else particles = particles.filter(particle => {
      if (particle.lane === 0) return true;
      particle.node.remove();
      return false;
    });
    drawVessels();
    renderParticles();
  }

  function stop() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    previousTime = 0;
  }

  function start() {
    if (!frame && active && playing && !document.hidden && inView && !destroyed) frame = requestAnimationFrame(tick);
  }

  function tick(time) {
    frame = 0;
    if (!root.isConnected) { destroy(); return; }
    if (!active || !playing || document.hidden || !inView || destroyed) return;
    const dt = previousTime ? Math.min(.045,(time - previousTime) / 1000) : .016;
    previousTime = time;
    const target = stressed ? 1 : 0;
    pressure += (target - pressure) * Math.min(1,dt * 5.5);
    if (Math.abs(target - pressure) < .002) pressure = target;
    drawVessels();
    const counts = [0,0,0];
    particles.forEach(particle => { counts[particle.branch] += 1; });
    branchPaths.forEach((path, branch) => {
      const laneCount = stressed && branch !== 1 ? 3 : 1;
      spawnCarry[branch] += dt * pulseRate(branch);
      while (spawnCarry[branch] >= 1) {
        spawnCarry[branch] -= 1;
        if (counts[branch] + laneCount <= particleLimit(branch)) {
          createPulse(branch,0);
          counts[branch] += laneCount;
        }
      }
    });
    particles = particles.filter(particle => {
      if (!stressed && particle.lane !== 0 && pressure < .01) {
        particle.node.remove();
        return false;
      }
      const nearPlaque = particle.branch === 1 ? Math.max(0,1 - Math.abs(particle.distance - geometry.plaqueDistance) / 33) : 0;
      const speed = particle.distance < trunkLength ? 82 + pressure * 60 : branchSpeed(particle.branch) * (1 + nearPlaque * .7);
      particle.distance += speed * dt;
      if (particle.distance > branchPaths[particle.branch].length) { particle.node.remove(); return false; }
      placeParticle(particle);
      return true;
    });
    start();
  }

  function visibilityChanged() {
    if (!root.isConnected) { destroy(); return; }
    if (document.hidden) stop(); else start();
  }

  function motionChanged(event) {
    if (event.matches) { playing = false; stop(); settleScene(); updateText(); }
  }

  const resizeObserver = new ResizeObserver(resize);
  const intersectionObserver = new IntersectionObserver(entries => {
    inView = entries[0]?.isIntersecting !== false;
    if (inView) start(); else stop();
  },{threshold:0});

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    stop();
    resizeObserver.disconnect();
    intersectionObserver.disconnect();
    document.removeEventListener('visibilitychange',visibilityChanged);
    motionQuery.removeEventListener('change',motionChanged);
  }

  qa('[data-exam]').forEach(button => button.addEventListener('click', () => {
    if (exam === button.dataset.exam) return;
    exam = button.dataset.exam;
    updateText();
    const selectedPanel = q(`[data-exam-panel="${exam}"]`);
    q('[data-announcement]').textContent = `${button.textContent.trim()}。${selectedPanel.textContent.replace(/\s+/g,' ').trim()} ${q('.se-research-note').textContent}`;
  }));
  qa('[data-state-button]').forEach(button => button.addEventListener('click', () => setState(button.dataset.stateButton === 'stress')));
  q('[data-motion]').addEventListener('click', () => {
    playing = !playing;
    updateText();
    if (playing) start(); else { stop(); settleScene(); }
  });
  document.addEventListener('visibilitychange',visibilityChanged);
  motionQuery.addEventListener('change',motionChanged);
  resizeObserver.observe(svg);
  intersectionObserver.observe(root);
  resize();
  updateText();
  start();
  return {
    setActive(value) {
      active = !!value;
      root.dataset.active = String(active);
      if (active) { resize(); start(); } else stop();
    },
    updateContent(resolve) { fieldResolver = resolve; updateText(); },
    destroy,
  };
}
