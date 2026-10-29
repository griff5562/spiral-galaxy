'use strict';
/*
 * Spiral Galaxy: see your vault as a slowly spinning spiral galaxy.
 *
 * Every note is a star, sized by its links. Each arm of the galaxy is a group of folders (yours to choose, or picked
 * automatically), each folder is a glowing star cluster along its arm with its hub note in the middle, your top-level
 * notes are the bright core, and any "moon" folders become a little satellite galaxy.
 * Hover a star for its name and links, click it to open the note, scroll to zoom, drag to move, and drag the bright
 * middle to swing the whole galaxy like jelly.
 *
 * Star positions are seeded from each note's path, so the galaxy looks the same every time you open it.
 * Speed: the nebulae, dust and core glow are painted once into one backdrop picture that is only turned and scaled each
 * frame; every star is one pre-made sprite; the view only redraws when something moves.
 */
const { Plugin, ItemView, PluginSettingTab, Setting, TFolder, debounce } = require('obsidian');

const VIEW_TYPE = 'spiral-galaxy-view';
const PALETTE = ['#7facdf', '#d77f8a', '#d7a17c', '#74c3c1', '#8fd48d', '#d78bca', '#d7b67c', '#ae95df', '#91ccdf'];
const DEFAULT_SETTINGS = {
	arms: [],               // [{ name, color, folders: [path, ...] }]; empty = chosen automatically from your folders
	coreFolders: [''],      // notes directly inside these folders form the bright core ('' = the vault root)
	coreName: 'Core', coreColor: '#d7bb73', coreAltColor: '#c2b8d8',
	moonFolders: [], moonName: 'Moon', moonColor: '#cbc7d7',
	homeNote: '', homeColor: '#f4f0fa',
	spinOnOpen: true, spinSpeed: 1, dust: 'normal', jelly: true, showLegend: true,
};
const DUST = { none: 0, light: 0.5, normal: 1, rich: 2 };
const R = 1000;          // galaxy radius (world units)
const WIND = 2.7;        // how far each arm curls (radians from core to tip)
const SPIN = 0.012;      // radians per second at spin speed 1
const FRAME = 16;        // ms between redraws (60 a second)
const TEX = 1400;        // backdrop picture size (px); it covers 1.45 R each way
// jelly drag: stiff near the core, loose at the edge, a little bouncy
const K_CORE = 70, K_EDGE = 7, BOUNCE = 0.45, K_BACKDROP = 14;
const HUB = /(start here|readme|index|hub|moc|overview)$|^00 /i;

function seeded(str) { // mulberry32 seeded from a string
	let h = 1779033703 ^ str.length;
	for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
	let a = h >>> 0;
	return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function gauss(rnd) { return Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(2 * Math.PI * rnd()); }
function armWidth(t) { return R * (0.016 + 0.045 * t); }
function rgba(hex, a) {
	let h = String(hex || '#ffffff').replace('#', '');
	if (h.length === 3) h = h.split('').map(c => c + c).join('');
	const n = parseInt(h, 16) || 0;
	return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}
function cleanFolder(p) { const f = String(p || '').trim().replace(/^\/+|\/+$/g, ''); return f; }
function lines(text) { return String(text || '').split('\n').map(l => l.trim()).filter(Boolean); }
function parentPath(file) { return file.parent && file.parent.path !== '/' ? file.parent.path : ''; }
function inFolder(path, folder) { return folder === '' || path.startsWith(folder + '/'); }

class GalaxyView extends ItemView {
	constructor(leaf, plugin) {
		super(leaf);
		this.plugin = plugin;
		this.stars = []; this.labels = []; this.byPath = new Map(); this.adj = new Map();
		this.zoom = 1; this.panX = 0; this.panY = 0; this.spin = 0; this.cs = 1; this.sn = 0;
		this.spinning = plugin.settings.spinOnOpen;
		this.hover = null; this.drag = null; this.glows = {}; this.starSprites = {}; this.dirty = true; this.lastDraw = 0;
		this.bg = { ox: 0, oy: 0, vx: 0, vy: 0 }; this.wobbling = false;
	}
	getViewType() { return VIEW_TYPE; }
	getDisplayText() { return 'Galaxy'; }
	getIcon() { return 'sparkles'; }

	async onOpen() {
		const el = this.contentEl;
		el.empty(); el.addClass('spiral-galaxy');
		this.canvas = el.createEl('canvas', { cls: 'spiral-galaxy-canvas' });
		this.ctx = this.canvas.getContext('2d');
		this.font = getComputedStyle(document.body).getPropertyValue('--font-interface').trim() || 'sans-serif';
		el.createDiv({ cls: 'spiral-galaxy-hint', text: 'Scroll to zoom · drag to move · drag the bright middle to swing it · click a star to open it' });
		this.legend = el.createDiv({ cls: 'spiral-galaxy-legend' });
		this.spinBtn = el.createEl('button', { cls: 'spiral-galaxy-spin' });
		this.spinBtn.setText('Spin: ' + (this.spinning ? 'on' : 'off'));
		this.registerDomEvent(this.spinBtn, 'click', () => { this.spinning = !this.spinning; this.spinBtn.setText('Spin: ' + (this.spinning ? 'on' : 'off')); });

		this.resize = new ResizeObserver(() => this.fit());
		this.resize.observe(el);
		this.registerDomEvent(this.canvas, 'wheel', e => this.onWheel(e), { passive: false });
		this.registerDomEvent(this.canvas, 'mousedown', e => {
			const home = !!this.hover && this.hover === this.home && this.plugin.settings.jelly;
			this.drag = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, px: this.panX, py: this.panY, moved: false, home };
		});
		this.registerDomEvent(window, 'mouseup', e => this.onUp(e));
		this.registerDomEvent(this.canvas, 'mousemove', e => this.onMove(e));
		this.registerDomEvent(this.canvas, 'mouseleave', () => { this.hover = null; this.dirty = true; });
		// right after Obsidian starts the links are still being read, so refresh the sizes every 2 s until they settle
		const later = () => { if (!this.rebuildTimer) this.rebuildTimer = window.setTimeout(() => { this.rebuildTimer = null; this.build(); }, 2000); };
		this.registerEvent(this.app.metadataCache.on('resolve', later));
		this.registerEvent(this.app.metadataCache.on('resolved', later));
		this.registerEvent(this.app.vault.on('rename', later));
		this.registerEvent(this.app.vault.on('delete', later));

		this.build(); this.fit();
		let last = performance.now();
		const loop = now => {
			if (this.closed) return;
			this.frame = requestAnimationFrame(loop);
			const dt = Math.min(0.1, (now - last) / 1000); last = now;
			if (this.wobbling) { this.wobbling = this.step(Math.min(dt, 1 / 30)); this.dirty = true; }
			if (this.spinning && !this.hover && !(this.drag && this.drag.moved)) { this.spin += dt * SPIN * this.plugin.settings.spinSpeed; this.dirty = true; }
			if (!this.dirty || now - this.lastDraw < FRAME || !this.contentEl.isShown()) return;
			this.lastDraw = now; this.dirty = false;
			this.draw();
		};
		this.frame = requestAnimationFrame(loop);
	}
	async onClose() {
		this.closed = true;
		cancelAnimationFrame(this.frame);
		if (this.resize) this.resize.disconnect();
		window.clearTimeout(this.rebuildTimer);
	}

	fit() {
		const r = this.contentEl.getBoundingClientRect();
		this.w = Math.max(1, r.width); this.h = Math.max(1, r.height); this.dpr = Math.min(window.devicePixelRatio || 1, 1.5);
		this.canvas.width = Math.round(this.w * this.dpr); this.canvas.height = Math.round(this.h * this.dpr);
		this.base = Math.min(this.w, this.h) / (2.35 * R);
		this.dirty = true;
	}

	renderLegend(arms, hasMoon) {
		const s = this.plugin.settings;
		this.legend.empty();
		this.legend.toggleClass('is-hidden', !s.showLegend);
		const row = (color, text) => {
			const r = this.legend.createDiv({ cls: 'spiral-galaxy-row' });
			r.createSpan({ cls: 'spiral-galaxy-dot' }).setCssProps({ '--spiral-galaxy-dot': color });
			r.createSpan({ text });
		};
		row(s.coreColor, s.coreName === 'Core' ? 'Core' : 'Core: ' + s.coreName);
		arms.forEach(a => row(a.color, a.name));
		if (hasMoon) row(s.moonColor, s.moonName === 'Moon' ? 'Moon' : 'Moon: ' + s.moonName);
	}

	// a soft glow per colour (for the backdrop), and a star stamp per colour: glow with a solid middle baked in
	glow(color) {
		if (this.glows[color]) return this.glows[color];
		const c = document.createElement('canvas'); c.width = c.height = 64;
		const g = c.getContext('2d'), grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
		grad.addColorStop(0, rgba(color, 1)); grad.addColorStop(0.25, rgba(color, 0.45)); grad.addColorStop(1, rgba(color, 0));
		g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
		return (this.glows[color] = c);
	}
	starSprite(color) {
		if (this.starSprites[color]) return this.starSprites[color];
		const c = document.createElement('canvas'); c.width = c.height = 48;
		const g = c.getContext('2d'), grad = g.createRadialGradient(24, 24, 0, 24, 24, 24);
		grad.addColorStop(0, rgba(color, 0.55)); grad.addColorStop(0.35, rgba(color, 0.22)); grad.addColorStop(1, rgba(color, 0));
		g.fillStyle = grad; g.fillRect(0, 0, 48, 48);
		g.fillStyle = color; g.beginPath(); g.arc(24, 24, 8, 0, 2 * Math.PI); g.fill(); // the star itself: 1/3 of the stamp
		return (this.starSprites[color] = c);
	}

	armPoint(k, t) {
		const th = (k * 2 * Math.PI) / this.armCount + WIND * t, r = R * (0.1 + 0.9 * t);
		return [Math.cos(th) * r, Math.sin(th) * r];
	}

	build() {
		const s = this.plugin.settings;
		let arms = s.arms, coreFolders = s.coreFolders;
		if (!arms.length) ({ arms, coreFolders } = this.plugin.autoArms());
		arms = arms.length ? arms : [{ name: 'Notes', color: PALETTE[0], folders: [] }];
		this.armCount = arms.length;
		coreFolders = coreFolders.map(cleanFolder);
		const moonFolders = s.moonFolders.map(cleanFolder).filter(Boolean);

		const files = this.app.vault.getMarkdownFiles(), links = this.app.metadataCache.resolvedLinks;
		const rules = [];
		arms.forEach((a, i) => a.folders.forEach(f => { const folder = cleanFolder(f); if (folder) rules.push({ folder, arm: i }); }));
		rules.sort((a, b) => b.folder.length - a.folder.length); // the deepest matching folder wins
		const clusters = arms.map(() => new Map()), core = [], moon = [], stray = [];
		for (const f of files) {
			const p = f.path;
			if (moonFolders.some(m => inFolder(p, m))) { moon.push(f); continue; }
			const rule = rules.find(r => inFolder(p, r.folder));
			if (rule) { const m = clusters[rule.arm]; if (!m.has(rule.folder)) m.set(rule.folder, []); m.get(rule.folder).push(f); continue; }
			if (coreFolders.includes(parentPath(f))) core.push(f); else stray.push(f);
		}
		// links both ways, for star sizes and the hover lines
		const adj = new Map(), add = (a, b) => { if (!adj.has(a)) adj.set(a, new Set()); adj.get(a).add(b); };
		for (const src in links) for (const dst in links[src]) if (src !== dst && dst.endsWith('.md')) { add(src, dst); add(dst, src); }
		const degree = f => (adj.has(f.path) ? adj.get(f.path).size : 0);
		// the note at the very centre: the one you picked, else Home.md, else the most-linked core note
		let home = files.find(f => f.path === cleanFolder(s.homeNote)) || core.find(f => f.path === 'Home.md') || null;
		if (!home && core.length) home = core.reduce((a, b) => (degree(b) > degree(a) ? b : a));

		const stars = [], byPath = new Map(), nebulae = [], labels = [], old = this.byPath;
		const star = (f, x, y, color) => {
			const deg = degree(f), isHome = f === home;
			const st = { file: f, x, y, color, deg, size: isHome ? 9 : Math.min(6, 1 + Math.pow(deg, 0.6) * 0.35) }; // (capped: home stays the biggest)
			// jelly: stiff near the core, loose at the edge, each a little different; the home star is the handle
			const d = Math.min(1, Math.hypot(x, y) / R);
			st.k = isHome ? 0 : (K_EDGE + (K_CORE - K_EDGE) * (1 - d) * (1 - d)) * (0.85 + 0.3 * seeded(f.path + '#k')());
			const was = old.get(f.path);
			st.ox = was ? was.ox : 0; st.oy = was ? was.oy : 0; st.vx = was ? was.vx : 0; st.vy = was ? was.vy : 0;
			stars.push(st); byPath.set(f.path, st);
		};
		// arms: each folder gets a stretch of its arm, longer for bigger folders; its hub note sits in the middle
		arms.forEach((arm, k) => {
			const secs = [...clusters[k].entries()].sort((a, b) => a[0].localeCompare(b[0]));
			const weights = secs.map(c => Math.sqrt(c[1].length) + 1), total = weights.reduce((a, b) => a + b, 0);
			let t = 0.06;
			secs.forEach(([folder, notes], i) => {
				const span = (0.94 * weights[i]) / total, tA = t, tB = t + span, mid = (tA + tB) / 2;
				t = tB;
				const [hx, hy] = this.armPoint(k, mid);
				nebulae.push({ x: hx, y: hy, r: armWidth(mid) * 2.6 + R * 0.02 * Math.sqrt(notes.length), color: arm.color });
				labels.push({ x: hx, y: hy, text: folder.split('/').pop().replace(/^\d+\s+/, ''), color: arm.color });
				const top = notes.filter(f => parentPath(f) === folder);
				const hub = top.find(f => HUB.test(f.basename)) || (top.length ? top.reduce((a, b) => (degree(b) > degree(a) ? b : a)) : null);
				for (const f of notes) {
					if (f === hub) { star(f, hx, hy, arm.color); continue; }
					const rnd = seeded(f.path);
					const tt = tA + (tB - tA) * (0.08 + 0.84 * rnd()), [ax, ay] = this.armPoint(k, tt), w = armWidth(tt);
					star(f, ax + gauss(rnd) * w, ay + gauss(rnd) * w, arm.color);
				}
			});
		});
		for (const f of core) {
			const rnd = seeded(f.path), isHome = f === home, root = parentPath(f) === '';
			star(f, isHome ? 0 : gauss(rnd) * R * 0.05, isHome ? 0 : gauss(rnd) * R * 0.05, isHome ? s.homeColor : root ? s.coreColor : s.coreAltColor);
		}
		const mx = R * 1.18, my = -R * 0.92;
		for (const f of moon) { const rnd = seeded(f.path); star(f, mx + gauss(rnd) * R * 0.05, my + gauss(rnd) * R * 0.05, s.moonColor); }
		if (moon.length) { nebulae.push({ x: mx, y: my, r: R * 0.16, color: s.moonColor }); labels.push({ x: mx, y: my - R * 0.12, text: s.moonName, color: s.moonColor }); }
		for (const f of stray) { const rnd = seeded(f.path), a = rnd() * 2 * Math.PI, r = R * (1.05 + 0.15 * rnd()); star(f, Math.cos(a) * r, Math.sin(a) * r, s.coreAltColor); }

		this.stars = stars; this.byPath = byPath; this.adj = adj; this.labels = labels; this.home = home ? byPath.get(home.path) : null;
		this.hover = this.hover ? byPath.get(this.hover.file.path) || null : null;
		const key = [s.dust, arms.map(a => a.color).join(), nebulae.map(n => n.color + n.r.toFixed(1)).join()].join('|');
		if (key !== this.backdropKey) { this.backdropKey = key; this.paintBackdrop(nebulae, arms); } // (only when it changes)
		this.renderLegend(arms, moon.length > 0);
		this.dirty = true;
	}

	// the core glow, the folder nebulae and the dust, painted once into one picture
	paintBackdrop(nebulae, arms) {
		const c = this.backdrop || (this.backdrop = document.createElement('canvas'));
		c.width = c.height = TEX;
		const g = c.getContext('2d'), k = TEX / (2.9 * R), P = (x, y) => [TEX / 2 + x * k, TEX / 2 + y * k];
		g.clearRect(0, 0, TEX, TEX);
		g.globalCompositeOperation = 'lighter';
		const cr = R * 0.3 * k;
		g.globalAlpha = 0.5; g.drawImage(this.glow('#ffe9b8'), TEX / 2 - cr, TEX / 2 - cr, cr * 2, cr * 2);
		g.globalAlpha = 0.9; g.drawImage(this.glow('#fff6e6'), TEX / 2 - cr / 3, TEX / 2 - cr / 3, (cr * 2) / 3, (cr * 2) / 3);
		g.globalAlpha = 0.16;
		for (const n of nebulae) { const [x, y] = P(n.x, n.y), r = n.r * k; g.drawImage(this.glow(n.color), x - r, y - r, r * 2, r * 2); }
		const amount = DUST[this.plugin.settings.dust] ?? 1;
		const rnd = seeded('dust'), speck = (x, y, a, size, color) => { const [px, py] = P(x, y); g.globalAlpha = a; g.fillStyle = color; g.fillRect(px, py, size, size); };
		for (let i = 0; i < Math.round(900 * amount); i++) {
			const f = Math.floor(rnd() * arms.length), t = Math.pow(rnd(), 0.8), [ax, ay] = this.armPoint(f, t), w = armWidth(t) * 2;
			speck(ax + gauss(rnd) * w, ay + gauss(rnd) * w, 0.1 + rnd() * 0.3, 0.7 + rnd() * 1.1, rnd() < 0.6 ? '#ffffff' : arms[f].color);
		}
		for (let i = 0; i < Math.round(300 * amount); i++) speck(gauss(rnd) * R * 0.11, gauss(rnd) * R * 0.11, 0.12 + rnd() * 0.35, 0.7 + rnd() * 1.2, rnd() < 0.5 ? '#fff4d6' : '#ffffff');
		for (let i = 0; i < Math.round(150 * amount); i++) { const a = rnd() * 2 * Math.PI, r = R * (0.2 + 1.2 * Math.sqrt(rnd())); speck(Math.cos(a) * r, Math.sin(a) * r, 0.05 + rnd() * 0.2, 0.6 + rnd() * 0.9, '#ffffff'); }
	}

	toScreen(x, y) {
		const s = this.base * this.zoom;
		return [this.w / 2 + this.panX + (x * this.cs - y * this.sn) * s, this.h / 2 + this.panY + (x * this.sn + y * this.cs) * s];
	}
	pos(st) { const [x, y] = this.toScreen(st.x, st.y); return [x + st.ox, y + st.oy]; } // where a star is drawn (with its lag)
	starRadius(st) { return st.size * Math.sqrt(this.zoom) * Math.max(0.7, this.base * 2.2); }

	// one spring step for every star and the backdrop; returns whether anything is still moving
	step(dt) {
		let moving = false;
		const spring = (o, k) => {
			const c = 2 * BOUNCE * Math.sqrt(k);
			o.vx += (-k * o.ox - c * o.vx) * dt; o.vy += (-k * o.oy - c * o.vy) * dt;
			o.ox += o.vx * dt; o.oy += o.vy * dt;
			if (Math.abs(o.ox) + Math.abs(o.oy) + Math.abs(o.vx) * 0.05 + Math.abs(o.vy) * 0.05 > 0.05) moving = true;
			else o.ox = o.oy = o.vx = o.vy = 0;
		};
		for (const st of this.stars) if (st.k) spring(st, st.k);
		spring(this.bg, K_BACKDROP);
		return moving || !!(this.drag && this.drag.home && this.drag.moved);
	}

	draw() {
		const c = this.ctx, W = this.w, H = this.h, s = this.base * this.zoom;
		this.cs = Math.cos(this.spin); this.sn = Math.sin(this.spin);
		c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
		c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
		c.clearRect(0, 0, W, H);
		const on = (x, y, m) => x > -m && y > -m && x < W + m && y < H + m;

		// the backdrop: one picture, turned and scaled
		c.save();
		c.imageSmoothingQuality = 'low';
		c.translate(W / 2 + this.panX + this.bg.ox, H / 2 + this.panY + this.bg.oy); c.rotate(this.spin);
		const k = s / (TEX / (2.9 * R)); c.scale(k, k);
		c.drawImage(this.backdrop, -TEX / 2, -TEX / 2);
		c.restore();

		// the hovered star's links
		const hov = this.hover, near = hov && this.adj.get(hov.file.path);
		if (near) {
			const [hx, hy] = this.pos(hov);
			c.lineWidth = 1; c.strokeStyle = rgba(hov.color, 1); c.globalAlpha = 0.35;
			c.beginPath();
			for (const p of near) { const o = this.byPath.get(p); if (!o) continue; const [x, y] = this.pos(o); c.moveTo(hx, hy); c.lineTo(x, y); }
			c.stroke();
		}
		// stars: one stamp each (glow + middle), dimmed when another star is hovered and they aren't linked
		for (const st of this.stars) {
			const [x, y] = this.pos(st), g = this.starRadius(st) * 3;
			if (!on(x, y, g)) continue;
			c.globalAlpha = hov && st !== hov && !(near && near.has(st.file.path)) ? 0.25 : 1;
			c.drawImage(this.starSprite(st.color), x - g, y - g, g * 2, g * 2);
		}
		// names: the home note always, the folders once zoomed in a bit, the hovered star on top
		c.globalAlpha = 1; c.textAlign = 'center'; c.textBaseline = 'bottom';
		if (this.home) {
			c.font = `600 12px ${this.font}`;
			const [x, y] = this.pos(this.home);
			this.text(this.home.file.basename, x, y - this.starRadius(this.home) - 6, this.plugin.settings.homeColor, 1);
		}
		if (this.zoom >= 1.5) {
			c.font = `600 11px ${this.font}`;
			const a = Math.min(0.85, (this.zoom - 1.5) * 1.5);
			for (const l of this.labels) { const [lx, ly] = this.toScreen(l.x, l.y), x = lx + this.bg.ox, y = ly + this.bg.oy; if (on(x, y, 100)) this.text(l.text, x, y - 10, l.color, a); }
		}
		if (hov) {
			const [x, y] = this.pos(hov);
			c.font = `700 13px ${this.font}`;
			this.text(`${hov.file.basename}  ·  ${hov.deg} links`, x, y - this.starRadius(hov) - 8, '#ffffff', 1);
		}
	}
	text(t, x, y, color, a) {
		const c = this.ctx;
		c.globalAlpha = a; c.lineWidth = 3; c.strokeStyle = 'rgba(8,5,16,0.85)'; c.strokeText(t, x, y);
		c.fillStyle = color; c.fillText(t, x, y); c.globalAlpha = 1;
	}
	setCursor(kind) {
		this.canvas.removeClass('is-pointer', 'is-grab', 'is-grabbing');
		this.canvas.addClass('is-' + kind);
	}

	onWheel(e) {
		e.preventDefault();
		const rect = this.canvas.getBoundingClientRect(), mx = e.clientX - rect.left - this.w / 2, my = e.clientY - rect.top - this.h / 2;
		const z = Math.min(14, Math.max(0.4, this.zoom * Math.exp(-e.deltaY * 0.0015))), f = z / this.zoom;
		this.panX = mx - (mx - this.panX) * f; this.panY = my - (my - this.panY) * f; this.zoom = z;
		this.dirty = true;
	}
	onMove(e) {
		const rect = this.canvas.getBoundingClientRect(), mx = e.clientX - rect.left, my = e.clientY - rect.top;
		if (this.drag) {
			const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
			if (Math.abs(dx) + Math.abs(dy) > 4) this.drag.moved = true;
			if (this.drag.moved && this.drag.home) {
				// the home star is the handle: the galaxy moves with it, but every other star (and the backdrop) is left
				// behind by the same amount and springs after it
				const sx = e.clientX - this.drag.lx, sy = e.clientY - this.drag.ly;
				this.drag.lx = e.clientX; this.drag.ly = e.clientY;
				this.panX += sx; this.panY += sy;
				for (const st of this.stars) if (st.k) { st.ox -= sx; st.oy -= sy; }
				this.bg.ox -= sx; this.bg.oy -= sy;
				this.hover = null; this.wobbling = true; this.dirty = true;
				this.setCursor('grabbing');
				return;
			}
			if (this.drag.moved) { this.panX = this.drag.px + dx; this.panY = this.drag.py + dy; this.hover = null; this.dirty = true; this.setCursor('grabbing'); return; }
		}
		let best = null, bd = Infinity;
		if (this.home) { // the bright middle is the handle: anywhere in its glow picks the home star
			const [x, y] = this.pos(this.home);
			if (Math.hypot(x - mx, y - my) < Math.max(24, this.starRadius(this.home) * 3)) best = this.home;
		}
		if (!best) for (const st of this.stars) {
			const [x, y] = this.pos(st), d = Math.hypot(x - mx, y - my), reach = Math.max(7, this.starRadius(st) + 3);
			if (d < reach && d < bd) { bd = d; best = st; }
		}
		if (best !== this.hover) { this.hover = best; this.dirty = true; }
		this.setCursor(best ? (best === this.home && this.plugin.settings.jelly ? 'grab' : 'pointer') : 'grab');
	}
	onUp(e) {
		const d = this.drag; this.drag = null;
		if (d && !d.moved && this.hover && e.target === this.canvas) this.app.workspace.getLeaf('tab').openFile(this.hover.file);
	}
}

class GalaxySettingTab extends PluginSettingTab {
	constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }

	display() {
		const { containerEl } = this, s = this.plugin.settings;
		containerEl.empty();
		const save = debounce(() => this.plugin.saveSettings(), 400, true);
		const saveNow = async () => { await this.plugin.saveSettings(); this.display(); };

		new Setting(containerEl).setName('Arms').setHeading();
		new Setting(containerEl)
			.setDesc(s.arms.length
				? 'Each arm is a list of folders. Every folder becomes a glowing star cluster on that arm.'
				: 'Arms are picked automatically from your folders. Fill them in to choose the names, colours and folders yourself.')
			.addButton(b => b.setButtonText(s.arms.length ? 'Go back to automatic' : 'Fill in from my folders').onClick(async () => {
				if (s.arms.length) s.arms = [];
				else { const auto = this.plugin.autoArms(); s.arms = auto.arms; s.coreFolders = auto.coreFolders; }
				await saveNow();
			}));
		s.arms.forEach((arm, i) => {
			new Setting(containerEl).setName(`Arm ${i + 1}`)
				.addText(t => t.setPlaceholder('Name').setValue(arm.name).onChange(v => { arm.name = v; save(); }))
				.addColorPicker(c => c.setValue(arm.color).onChange(v => { arm.color = v; save(); }))
				.addExtraButton(b => b.setIcon('arrow-up').setTooltip('Move up').setDisabled(i === 0).onClick(async () => {
					if (i > 0) { [s.arms[i - 1], s.arms[i]] = [s.arms[i], s.arms[i - 1]]; await saveNow(); }
				}))
				.addExtraButton(b => b.setIcon('trash').setTooltip('Remove arm').onClick(async () => { s.arms.splice(i, 1); await saveNow(); }));
			new Setting(containerEl).setDesc('Folders on this arm, one per line')
				.addTextArea(t => {
					t.setValue(arm.folders.join('\n')).onChange(v => { arm.folders = lines(v); save(); });
					t.inputEl.rows = Math.min(10, Math.max(2, arm.folders.length));
					t.inputEl.addClass('spiral-galaxy-folders');
				});
		});
		if (s.arms.length) new Setting(containerEl).addButton(b => b.setButtonText('Add arm').onClick(async () => {
			s.arms.push({ name: 'New arm', color: PALETTE[s.arms.length % PALETTE.length], folders: [] });
			await saveNow();
		}));

		new Setting(containerEl).setName('Core').setHeading();
		new Setting(containerEl).setName('Core folders')
			.setDesc('Notes sitting directly inside these folders form the bright core. One per line; "/" is the vault root.')
			.addTextArea(t => t.setValue(s.coreFolders.map(f => f || '/').join('\n')).onChange(v => { s.coreFolders = lines(v).map(f => (f === '/' ? '' : cleanFolder(f))); save(); }));
		new Setting(containerEl).setName('Core name').setDesc('Shown in the legend.')
			.addText(t => t.setValue(s.coreName).onChange(v => { s.coreName = v || 'Core'; save(); }));
		new Setting(containerEl).setName('Core colours').setDesc('Notes in the vault root, then notes in the other core folders.')
			.addColorPicker(c => c.setValue(s.coreColor).onChange(v => { s.coreColor = v; save(); }))
			.addColorPicker(c => c.setValue(s.coreAltColor).onChange(v => { s.coreAltColor = v; save(); }));
		new Setting(containerEl).setName('Centre note')
			.setDesc('The note at the very centre, which you drag to swing the galaxy, e.g. "Home.md". Leave empty to pick it automatically.')
			.addText(t => t.setPlaceholder('Home.md').setValue(s.homeNote).onChange(v => { s.homeNote = v.trim(); save(); }))
			.addColorPicker(c => c.setValue(s.homeColor).onChange(v => { s.homeColor = v; save(); }));

		new Setting(containerEl).setName('Moon').setHeading();
		new Setting(containerEl).setName('Moon folders')
			.setDesc('These folders become a little satellite galaxy, e.g. references or archives. One per line.')
			.addTextArea(t => t.setValue(s.moonFolders.join('\n')).onChange(v => { s.moonFolders = lines(v).map(cleanFolder); save(); }));
		new Setting(containerEl).setName('Moon name and colour')
			.addText(t => t.setValue(s.moonName).onChange(v => { s.moonName = v || 'Moon'; save(); }))
			.addColorPicker(c => c.setValue(s.moonColor).onChange(v => { s.moonColor = v; save(); }));

		new Setting(containerEl).setName('Look and feel').setHeading();
		new Setting(containerEl).setName('Spin when opened')
			.addToggle(t => t.setValue(s.spinOnOpen).onChange(v => { s.spinOnOpen = v; save(); }));
		new Setting(containerEl).setName('Spin speed')
			.addSlider(sl => sl.setLimits(0.25, 4, 0.25).setValue(s.spinSpeed).setDynamicTooltip().onChange(v => { s.spinSpeed = v; save(); }));
		new Setting(containerEl).setName('Space dust')
			.addDropdown(d => d.addOptions({ none: 'None', light: 'Light', normal: 'Normal', rich: 'Rich' }).setValue(s.dust).onChange(v => { s.dust = v; save(); }));
		new Setting(containerEl).setName('Jelly drag').setDesc('Drag the bright middle and the arms trail behind and wobble into place.')
			.addToggle(t => t.setValue(s.jelly).onChange(v => { s.jelly = v; save(); }));
		new Setting(containerEl).setName('Show legend')
			.addToggle(t => t.setValue(s.showLegend).onChange(v => { s.showLegend = v; save(); }));
	}
}

module.exports = class SpiralGalaxyPlugin extends Plugin {
	async onload() {
		await this.loadSettings();
		this.registerView(VIEW_TYPE, leaf => new GalaxyView(leaf, this));
		this.addRibbonIcon('sparkles', 'Open galaxy', () => this.activateView());
		this.addCommand({ id: 'open', name: 'Open galaxy', callback: () => this.activateView() });
		this.addSettingTab(new GalaxySettingTab(this.app, this));
	}

	async loadSettings() { this.settings = Object.assign(JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), await this.loadData()); }
	async saveSettings() {
		await this.saveData(this.settings);
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) if (leaf.view instanceof GalaxyView) leaf.view.build();
	}

	async activateView() {
		const ws = this.app.workspace, open = ws.getLeavesOfType(VIEW_TYPE);
		if (open.length) { ws.revealLeaf(open[0]); return; }
		const leaf = ws.getLeaf('tab');
		await leaf.setViewState({ type: VIEW_TYPE, active: true });
		ws.revealLeaf(leaf);
	}

	// Arms picked from your folders when you haven't chosen any: each top-level folder is a star cluster. If one folder
	// holds most of the vault, its subfolders are used instead (and its own loose notes join the core). Up to 9
	// clusters get an arm each; more are shared out over 8 arms. Big and small arms alternate round the circle.
	autoArms() {
		const moon = this.settings.moonFolders.map(cleanFolder).filter(Boolean);
		const counts = new Map();
		for (const f of this.app.vault.getMarkdownFiles()) {
			for (let p = f.parent; p && p.path !== '/'; p = p.parent) counts.set(p.path, (counts.get(p.path) || 0) + 1);
		}
		const count = folder => counts.get(folder.path) || 0;
		const kids = folder => folder.children.filter(c => c instanceof TFolder && !c.name.startsWith('.') && !moon.some(m => inFolder(c.path + '/', m) || c.path === m) && count(c) > 0);
		let clusters = kids(this.app.vault.getRoot());
		const coreFolders = [''];
		for (let guard = 0; guard < 4; guard++) {
			const total = clusters.reduce((a, c) => a + count(c), 0) || 1;
			const big = clusters.find(c => count(c) / total >= 0.6 && kids(c).length >= 3);
			if (!big) break;
			clusters = clusters.filter(c => c !== big).concat(kids(big));
			coreFolders.push(big.path);
		}
		clusters.sort((a, b) => a.path.localeCompare(b.path));
		const groups = clusters.length <= 9
			? clusters.map(c => [c])
			: Array.from({ length: 8 }, (_, i) => clusters.slice(Math.floor((i * clusters.length) / 8), Math.floor(((i + 1) * clusters.length) / 8)));
		const nice = n => n.replace(/^\d+[\s._-]*/, '') || n;
		const arms = groups.filter(g => g.length).map(g => ({
			name: g.length === 1 ? nice(g[0].name) : `${nice(g[0].name)} +${g.length - 1}`,
			folders: g.map(c => c.path),
			size: g.reduce((a, c) => a + count(c), 0),
		}));
		arms.sort((a, b) => b.size - a.size);
		const order = [];
		while (arms.length) { order.push(arms.shift()); if (arms.length) order.push(arms.pop()); }
		return { arms: order.map((a, i) => ({ name: a.name, color: PALETTE[i % PALETTE.length], folders: a.folders })), coreFolders };
	}
};
