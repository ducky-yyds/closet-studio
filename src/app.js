import { CATEGORIES, COLORS, SEASONS, STYLES, uid, today, loadState, saveState, seedState } from './data.js';
import { escapeHtml as h, statsFor, validateBackup, deleteItem, addDiary, removeDiary, suggestOutfit, layoutOutfit, isRealPhoto, isProcessedPhoto, isFlatlayPhoto, isCutoutPhoto, outfitSuggestionStatus } from './model.js';
import { removeBackground } from './cutout.js';
import { getFlatlayConfig, setFlatlayConfig, checkFlatlayService, generateFlatlay } from './flatlay.js';
import { inspectFiles, imageFileError, photoName, guessCategory } from './uploads.js';

const icons = {
  hanger: '<path d="M9 6a3 3 0 0 1 6 0c0 2-3 2-3 5L3 17c-1 .7-.5 2 1 2h16c1.5 0 2-1.3 1-2l-9-6"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  sparkle: '<path d="m12 3 2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6L12 3Z"/><path d="m20 2 .7 2.3L23 5l-2.3.7L20 8l-.7-2.3L17 5l2.3-.7Z"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18m-13 5h1m6 0h1"/>',
  chart: '<path d="M4 3v17h17M8 15v-5m5 5V6m5 9v-3"/>',
  settings: '<path d="m9 3-1 3-3 1-2 4 2 2v3l4 2 3-1 3 1 4-2v-3l2-2-2-4-3-1-1-3H9Z"/><circle cx="12" cy="11" r="3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  back: '<path d="m15 5-7 7 7 7"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  heart: '<path d="M20.5 4.9a5 5 0 0 0-7.1 0L12 6.3l-1.4-1.4a5 5 0 0 0-7.1 7.1L12 20.5l8.5-8.5a5 5 0 0 0 0-7.1Z"/>',
  download: '<path d="M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4"/>',
  upload: '<path d="M12 16V4m-4 4 4-4 4 4M4 16v4h16v-4"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  edit: '<path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-4-4L5 15l-1 5Z"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  check: '<path d="m5 12 4 4 10-10"/>',
  leaf: '<path d="M20 3C9 2 3 7 4 14c1 7 9 7 13 3 3-3 3-8 3-14ZM4 20 15 9"/>',
  shirt: '<path d="m8 3-6 4 3 5 3-2v11h8V10l3 2 3-5-6-4c0 4-8 4-8 0Z"/>',
  layers: '<path d="m12 3 10 5-10 5L2 8l10-5Zm-10 9 10 5 10-5M2 16l10 5 10-5"/>',
  refresh: '<path d="M20 8a8 8 0 0 0-14-2L3 9m0-6v6h6m-5 7a8 8 0 0 0 14 2l3-3m0 6v-6h-6"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1"/>',
  bag: '<path d="M5 7h14l2 14H3L5 7Zm3 0V5a4 4 0 0 1 8 0v2"/>',
};
const icon = (name, cls = '') => `<svg class="icon ${cls}" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.hanger}</svg>`;
const money = value => Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 0 });
const btn = (action, label, name = '', cls = 'button', extra = '') => `<button type="button" class="${cls}" data-action="${action}" ${extra}>${name ? icon(name) : ''}${label}</button>`;
const routes = { wardrobe: ['我的衣橱','grid','WARDROBE'], studio: ['搭配工作室','sparkle','OUTFIT STUDIO'], calendar: ['穿搭日历','calendar','STYLE DIARY'], insights: ['衣橱报告','chart','WARDROBE INSIGHTS'], settings: ['数据与设置','settings','YOUR SPACE'] };
const ui = { route: location.hash.slice(1) || 'wardrobe', category: '全部', season: '全部季节', style: '全部风格', favorite: false, sort: 'newest', search: '', month: today().slice(0,7), selectedDate: today(), studioCategory: '全部', draft: { name: '', background: '#f3f0e9', elements: [] }, selected: null };
if (!routes[ui.route]) ui.route = 'wardrobe';
let state, dialogReturnFocus, dialogCleanup, toastTimeout, saving = false, storageBroken = false;
const app = document.querySelector('#app');
const modalRoot = document.querySelector('#modal-root');
let modalImage = '', modalOriginal = '', modalCutoutStatus = 'original', modalPhotoSource = 'demo';
let modalImageKind='original',modalPendingResult=null;
let uploadSession = null;

function toast(message) {
  const element = document.querySelector('#toast');
  element.textContent = message;
  element.classList.add('visible');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => element.classList.remove('visible'), 3500);
}

async function commit(next, message = '') {
  if (saving) { toast('正在保存，请稍候再操作。'); return false; }
  if (storageBroken) { toast('浏览器存储不可用，请先导出当前数据并检查浏览器设置。'); return false; }
  saving = true;
  try {
    next._revision = state._revision || 0;
    validateBackup(next);
    await saveState(next);
    state = next;
    render();
    if (message) toast(message);
    return true;
  } catch (error) {
    if (error.code === 'CONFLICT') {
      state = await loadState();
      render();
      toast('另一窗口已更新衣橱。已同步最新数据，请重新操作。');
    } else { console.error('Save failed', error.name); toast('保存失败：浏览器空间不足或存储被禁用。请导出备份后重试。'); }
    return false;
  } finally { saving = false; }
}

function navigate(route) {
  if (!routes[route]) return;
  location.hash = route;
  ui.route = route;
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function render() {
  ui.draft.elements = ui.draft.elements.filter(element => state.items.some(item => item.id === element.itemId));
  if (!ui.draft.elements.some(element => element.key === ui.selected)) ui.selected = null;
  if (ui.draft.id && !state.outfits.some(outfit => outfit.id === ui.draft.id)) delete ui.draft.id;
  const [title] = routes[ui.route];
  const total = statsFor(state);
  app.innerHTML = `<aside class="sidebar">
    <a class="brand" href="#wardrobe" aria-label="衣间首页"><span class="brand-symbol">${icon('hanger')}</span><span>衣间<small>CLOSET STUDIO</small></span></a>
    <div class="sidebar-label">MY PERSONAL SPACE</div>
    <nav aria-label="主导航">${Object.entries(routes).map(([key,[label,name]]) => `<a href="#${key}" class="nav-link ${key === ui.route ? 'active' : ''}" ${key === ui.route ? 'aria-current="page"' : ''}>${icon(name)}<span>${label}</span>${key === 'wardrobe' ? `<span class="nav-count">${total.count}</span>` : ''}</a>`).join('')}</nav>
    <div class="sidebar-note"><span class="note-icon">${icon('leaf')}</span><strong>少一点纠结，多一点喜欢。</strong><p>让每一件衣服，<br>都有被好好穿着的机会。</p></div>
    <div class="sidebar-bottom"><span class="status-dot ${storageBroken ? 'offline' : ''}"></span>${storageBroken ? '存储不可用' : '已保存在此浏览器'}${btn('go-settings',icon('settings'),'','icon-button','aria-label="数据设置"')}</div>
  </aside>
  <div class="main-shell"><header class="topbar"><div class="breadcrumb">我的空间 ${icon('chevron')} <strong>${title}</strong></div><div class="topbar-right"><span class="today-label">${new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' })}</span>${btn('export-backup','备份','download','topbar-backup')}<button class="avatar" data-action="go-settings" aria-label="个人设置">衣</button></div></header>
    <main id="main-content">${({wardrobe: wardrobeView, studio: studioView, calendar: calendarView, insights: insightsView, settings: settingsView})[ui.route]()}</main>
    <footer class="page-footer"><span>衣间 · 每天，穿得更像自己。</span><span>MADE FOR YOUR EVERYDAY</span></footer>
  </div>
  <nav class="mobile-nav" aria-label="手机导航">${Object.entries(routes).map(([key,[label,name]]) => `<a href="#${key}" class="${key===ui.route?'active':''}" ${key === ui.route ? 'aria-current="page"' : ''}>${icon(name)}<span>${label.replace('工作室','').replace('衣橱报告','报告').replace('数据与设置','设置')}</span></a>`).join('')}</nav>`;
  if (ui.route === 'studio') bindStudioPointer();
}

function heading(eyebrow, title, subtitle, action = '') {
  return `<div class="page-heading"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${subtitle}</p></div>${action}</div>`;
}

function garmentCard(item, compact = false) {
  return `<article class="garment-card ${compact?'compact':''}"><button class="garment-photo" data-action="${compact?'studio-add':'item-detail'}" data-id="${h(item.id)}" aria-label="${compact?'加入搭配：':'查看衣物：'}${h(item.name)}"><img src="${h(item.image)}" alt="${h(item.name)}" loading="lazy" />${compact ? `<span class="add-hover">${icon('plus')}</span>` : `<span class="wear-label">${item.wearCount ? `穿过 ${item.wearCount} 次` : '还没穿过'}</span>`}</button>${!compact ? `<button class="favorite-button ${item.favorite?'is-favorite':''}" data-action="favorite" data-id="${h(item.id)}" aria-label="${item.favorite?'取消收藏':'收藏'}${h(item.name)}" aria-pressed="${item.favorite}">${icon('heart')}</button>` : ''}<div class="garment-info"><button data-action="${compact?'studio-add':'item-detail'}" data-id="${h(item.id)}">${h(item.name)}</button>${!compact?`<div class="garment-meta"><span><i style="background:${item.color}"></i>${h(item.colorName)} · ${h(item.category)}</span><span>¥${money(item.price)}</span></div>`:''}</div></article>`;
}

function filteredItems() {
  let items = state.items.filter(item => (ui.category==='全部'||item.category===ui.category) && (ui.season==='全部季节'||item.seasons.includes(ui.season)) && (ui.style==='全部风格'||item.style===ui.style) && (!ui.favorite||item.favorite) && `${item.name} ${item.brand} ${item.colorName} ${item.notes}`.toLowerCase().includes(ui.search.toLowerCase()));
  items = [...items];
  const sorts = { newest: (a,b)=>b.createdAt.localeCompare(a.createdAt), wear: (a,b)=>b.wearCount-a.wearCount, unworn: (a,b)=>a.wearCount-b.wearCount, price: (a,b)=>b.price-a.price, color: (a,b)=>a.colorName.localeCompare(b.colorName,'zh-CN') };
  return items.sort(sorts[ui.sort] || sorts.newest);
}

function wardrobeView() {
  const stats = statsFor(state), items = filteredItems();
  const unprocessed = state.items.filter(item=>isRealPhoto(item)&&!isProcessedPhoto(item)).length;
  const photos = state.items.filter(isProcessedPhoto);
  const heroTop=photos.find(i=>i.category==='上装')||photos[0], heroBottom=photos.find(i=>i.category==='下装')||photos[1]||photos[0], heroAccessory=photos.find(i=>i.category==='配饰')||photos[2]||photos[0];
  return `${heading('A LITTLE MORE YOU', h(state.settings.name), '把喜欢的衣服收好，把日常穿成自己的风格。', `<div class="heading-actions">${btn('batch-open','批量上传','upload','button')}${btn('add-item','添加衣物','plus','button primary')}</div>`)}
    <section class="welcome-banner"><div class="welcome-copy"><span class="pill">${icon('leaf')} 给衣橱一点新灵感</span><h2>好风格，<br>从你已有的衣服开始。</h2><p>换一种组合，发现熟悉单品的新可能。</p>${btn('start-suggestion','为我搭一套','arrow','button dark')}</div><div class="hero-art" aria-hidden="true"><span class="hero-caption">${photos.length?'YOUR REAL WARDROBE':'THE EVERYDAY EDIT'}</span><div class="hero-frame"><img class="hero-shirt" src="${h(heroTop?.image||'./assets/garments/cotton-shirt.svg')}" alt=""/><img class="hero-trousers" src="${h(heroBottom?.image||'./assets/garments/tailored-trousers.svg')}" alt=""/><img class="hero-bag" src="${h(heroAccessory?.image||'./assets/garments/shoulder-bag.svg')}" alt=""/><span class="hero-label">less, but better.</span></div><div class="hero-swatches"><i></i><i></i><i></i><span>YOUR STYLE, REIMAGINED</span></div></div></section>
    <section class="stats-strip" aria-label="衣橱概览"><div><span class="stat-icon">${icon('hanger')}</span><span><small>衣橱单品</small><strong>${stats.count}<em>件</em></strong></span><span class="stat-aside">每件都值得喜欢</span></div><div><span class="stat-icon">${icon('layers')}</span><span><small>已存搭配</small><strong>${state.outfits.length}<em>套</em></strong></span><button data-action="go-studio" class="stat-aside link-text">打开搭配 ${icon('arrow')}</button></div><div><span class="stat-icon">${icon('calendar')}</span><span><small>穿搭记录</small><strong>${state.diary.length}<em>次</em></strong></span><button data-action="go-calendar" class="stat-aside link-text">记录今天 ${icon('arrow')}</button></div></section>
    <button class="wardrobe-drop" data-action="batch-open" data-upload-drop="wardrobe">${icon('upload')}<span><strong>拖入穿着照片，提取衣物并生成平铺图</strong><small>先选择目标衣物，再生成并核对结果 · 每批最多 30 张</small></span>${icon('plus')}</button>
    ${unprocessed?`<div class="photo-processing-note"><span>${unprocessed} 件照片尚未确认为平铺衣物</span>${btn('batch-existing','生成平铺图','sparkle','text-button')}</div>`:''}
    <section class="wardrobe-section"><div class="section-title"><h2>所有衣物 <span>${state.items.length}</span></h2><label class="search-box">${icon('search')}<input id="wardrobe-search" type="search" value="${h(ui.search)}" placeholder="搜索衣物、品牌、颜色" aria-label="搜索衣物、品牌、颜色" /></label></div><div class="category-tabs" role="group" aria-label="衣物分类">${CATEGORIES.map(category=>btn('filter-category',`${category}<span>${category==='全部'?state.items.length:state.items.filter(i=>i.category===category).length}</span>`,'',`category-tab ${ui.category===category?'active':''}`,`data-category="${category}" aria-pressed="${ui.category===category}"`)).join('')}</div>
    <div class="filter-row"><div class="filter-controls"><label class="select-wrap"><select id="season-filter" aria-label="季节筛选">${['全部季节',...SEASONS].map(value=>`<option ${ui.season===value?'selected':''}>${value}</option>`).join('')}</select>${icon('down')}</label><label class="select-wrap"><select id="style-filter" aria-label="风格筛选">${['全部风格',...STYLES].map(value=>`<option ${ui.style===value?'selected':''}>${value}</option>`).join('')}</select>${icon('down')}</label>${btn('filter-favorite','只看收藏','heart',`filter-favorite ${ui.favorite?'active':''}`,`aria-pressed="${ui.favorite}"`)}</div><label class="select-wrap sort"><select id="sort-filter" aria-label="衣物排序">${[['newest','最近添加'],['wear','穿着最多'],['unworn','穿着最少'],['price','价格从高到低'],['color','按颜色排序']].map(([value,label])=>`<option value="${value}" ${ui.sort===value?'selected':''}>${label}</option>`).join('')}</select>${icon('down')}</label></div>
    <div id="garment-results">${garmentResults(items)}</div></section>`;
}

function garmentResults(items) {
  return items.length ? `<div class="garment-grid">${items.map(item=>garmentCard(item)).join('')}<button class="add-garment-card" data-action="add-item"><span>${icon('plus')}</span><strong>给衣橱添一件</strong><small>上传照片，收好你的喜欢</small></button></div><div class="results-caption">共 ${items.length} 件衣物 · 属于你的日常收藏</div>` : `<div class="empty-state">${icon('hanger')}<h3>${state.items.length?'没有找到符合条件的衣物':'你的衣橱，等你来填满'}</h3><p>${state.items.length?'试试其他分类，或调整筛选条件。':'拍张照片，把第一件喜欢的衣服收进来。'}</p>${state.items.length?btn('reset-filters','重置筛选','','button'):btn('add-item','添加第一件衣物','plus','button primary')}</div>`;
}

function outfitPreview(outfit, cls = '') {
  return `<div class="outfit-preview ${cls}" style="background:${outfit.background}">${outfit.elements.map(element=>{
    const item = state.items.find(item=>item.id===element.itemId);
    return item ? `<img src="${h(item.image)}" alt="" style="left:${element.x/640*100}%;top:${element.y/700*100}%;width:${element.width/640*100}%;transform:translate(-50%,-50%) rotate(${element.rotation}deg);z-index:${element.z}"/>` : '';
  }).join('')}</div>`;
}

function studioView() {
  const selected = ui.draft.elements.find(element=>element.key===ui.selected);
  const pool = state.items.filter(item=>ui.studioCategory==='全部'||item.category===ui.studioCategory);
  return `${heading('MAKE IT YOURS','搭配工作室','自动搭配使用已确认的平铺衣物图；也可点选衣物，自由组合。',btn('suggestion','自动搭配','sparkle','button primary'))}
    <div class="studio-layout"><section class="studio-closet panel"><div class="panel-heading"><h2>从衣橱挑选</h2><span>${state.items.length} 件</span></div><label class="select-wrap full"><select id="studio-category" aria-label="工作室衣物分类">${CATEGORIES.map(c=>`<option ${ui.studioCategory===c?'selected':''}>${c}</option>`).join('')}</select>${icon('down')}</label><div class="studio-items">${pool.length?pool.map(item=>garmentCard(item,true)).join(''):`<div class="small-empty">暂无衣物${btn('add-item','添加衣物','plus')}</div>`}</div></section>
    <section class="studio-editor panel"><div class="canvas-toolbar"><label class="outfit-name"><input id="draft-name" placeholder="为这套搭配起个名字" maxlength="80" value="${h(ui.draft.name)}" aria-label="搭配名称"/></label>${btn('clear-draft',icon('refresh'),'','icon-button','aria-label="清空画布"')}</div><div class="canvas-wrap"><div class="canvas-board" id="canvas-board" style="background:${ui.draft.background}" aria-label="搭配画布">${studioElements()}${!ui.draft.elements.length?`<div class="canvas-empty">${icon('hanger')}<h3>今天，想怎么穿？</h3><p>从左侧选几件衣物<br>或让搭配灵感帮你开个头</p></div>`:''}<span class="canvas-signature">衣间 / YOUR EVERYDAY EDIT</span></div></div><div class="canvas-controls"><label>画布底色 <input id="canvas-color" type="color" value="${ui.draft.background}" aria-label="画布背景色"/></label><span>拖动衣物 · 自由组合</span></div><div class="selection-controls ${!selected?'disabled':''}"><label>大小 <input id="element-size" type="range" min="60" max="500" value="${selected?.width||220}" ${!selected?'disabled':''}/></label><label>旋转 <input id="element-rotation" type="range" min="-180" max="180" value="${selected?.rotation||0}" ${!selected?'disabled':''}/></label>${btn('element-front','置顶','layers','icon-label',!selected?'disabled':'')}${btn('element-remove','移除','trash','icon-label',!selected?'disabled':'')}</div><div class="canvas-actions">${btn('export-outfit','导出图片','download','button')}${btn('save-outfit','保存搭配','check','button primary')}</div></section></div>
    <section class="saved-outfits"><div class="section-title"><h2>我的搭配收藏 <span>${state.outfits.length}</span></h2><span class="muted">把好灵感留给下一次</span></div>${state.outfits.length?`<div class="outfit-grid">${state.outfits.map(outfit=>`<article class="outfit-card"><button class="outfit-open" data-action="load-outfit" data-id="${h(outfit.id)}" aria-label="编辑搭配 ${h(outfit.name)}">${outfitPreview(outfit)}</button><div class="outfit-card-info"><h3>${h(outfit.name)}</h3><div><span>${new Set(outfit.elements.map(e=>e.itemId)).size} 件单品</span>${btn('wear-outfit','记录穿着','calendar','text-button',`data-id="${h(outfit.id)}"`)}${btn('delete-outfit',icon('trash'),'','icon-button',`data-id="${h(outfit.id)}" aria-label="删除搭配 ${h(outfit.name)}"`)}</div></div></article>`).join('')}</div>`:`<div class="empty-inline">${icon('layers')} 你的第一套搭配，会从这里开始。</div>`}</section>`;
}

function studioElements() {
  return ui.draft.elements.map(element=>{
    const item = state.items.find(item=>item.id===element.itemId);
    return item ? `<button class="canvas-element ${ui.selected===element.key?'selected':''}" data-element="${element.key}" aria-label="移动 ${h(item.name)}" style="left:${element.x/640*100}%;top:${element.y/700*100}%;width:${element.width/640*100}%;transform:translate(-50%,-50%) rotate(${element.rotation}deg);z-index:${element.z}"><img draggable="false" src="${h(item.image)}" alt="${h(item.name)}"/></button>` : '';
  }).join('');
}

function calendarView() {
  const [year,month] = ui.month.split('-').map(Number);
  const first = new Date(year,month-1,1), days = new Date(year,month,0).getDate(), offset = (first.getDay()+6)%7;
  const monthEntries = state.diary.filter(entry=>entry.date.startsWith(ui.month));
  const entries = state.diary.filter(entry=>entry.date===ui.selectedDate);
  return `${heading('DRESS. LIVE. REMEMBER.','穿搭日历','记下每一天的搭配，慢慢发现自己的风格。',btn('add-diary','记录穿搭','plus','button primary'))}
    <div class="calendar-layout"><section class="calendar-panel panel"><div class="calendar-heading"><h2>${year} 年 ${month} 月</h2><div>${btn('month-prev',icon('back'),'','icon-button','aria-label="上个月"')}${btn('month-today','今天','','text-button')}${btn('month-next',icon('chevron'),'','icon-button','aria-label="下个月"')}</div></div><div class="calendar-week">${['一','二','三','四','五','六','日'].map(day=>`<span>${day}</span>`).join('')}</div><div class="calendar-days">${'<div class="calendar-blank"></div>'.repeat(offset)}${Array.from({length:days},(_,index)=>{
      const date = `${ui.month}-${String(index+1).padStart(2,'0')}`, records = monthEntries.filter(entry=>entry.date===date);
      const firstItem = records.length?state.items.find(item=>records[0].itemIds.includes(item.id)):null;
      return `<button class="calendar-day ${date===ui.selectedDate?'selected':''} ${date===today()?'today':''}" data-action="select-date" data-date="${date}" aria-label="${date}，${records.length} 次穿搭" aria-pressed="${date===ui.selectedDate}"><span>${index+1}</span>${firstItem?`<img src="${h(firstItem.image)}" alt=""/><i>${records.length} 次</i>`:''}</button>`;
    }).join('')}</div><div class="calendar-caption">本月记录了 ${new Set(monthEntries.map(entry=>entry.date)).size} 天 · ${monthEntries.length} 次穿搭</div></section><section class="day-panel panel"><div class="panel-heading"><h2>${Number(ui.selectedDate.slice(5,7))} 月 ${Number(ui.selectedDate.slice(8))} 日</h2>${btn('add-diary',icon('plus'),'','icon-button','aria-label="为这一天记录穿搭"')}</div>${entries.length?entries.map(entry=>`<article class="diary-entry"><h3>${h(entry.name||'今日穿搭')}</h3><div class="diary-images">${entry.itemIds.map(id=>state.items.find(item=>item.id===id)).filter(Boolean).map(item=>`<img src="${h(item.image)}" alt="${h(item.name)}" title="${h(item.name)}"/>`).join('')}</div><p>${h(entry.notes||'又是穿得自在的一天。')}</p>${btn('delete-diary','删除记录','trash','text-button muted',`data-id="${h(entry.id)}"`)}</article>`).join(''):`<div class="empty-state small">${icon('calendar')}<h3>留住今天的风格</h3><p>这一日还没有穿搭记录。</p>${btn('add-diary','记录这一天','plus','button')}</div>`}</section></div>`;
}

function insightsView() {
  const stats = statsFor(state), maxCategory = Math.max(1,...CATEGORIES.slice(1).map(c=>state.items.filter(item=>item.category===c).length));
  const most = [...state.items].sort((a,b)=>b.wearCount-a.wearCount).filter(item=>item.wearCount>0).slice(0,4);
  const less = state.items.filter(item=>!item.wearCount).slice(0,4);
  return `${heading('KNOW YOUR WARDROBE','衣橱报告','了解自己的喜好，让每一件衣服都穿得值得。')}
    <div class="report-stats">${[['衣橱总价值',`¥${money(stats.total)}`,'按记录的购入价格计算','bag'],['累计穿着次数',stats.wears,'所有单品的穿着次数之和','calendar'],['平均单次成本',stats.averageCost===null?'—':`¥${stats.averageCost.toFixed(1)}`,'总购入价格 ÷ 总穿着次数','chart'],['待解锁单品',`${stats.unworn} 件`,'给这些衣服一次出场机会','hanger']].map(([label,value,caption,name])=>`<article class="report-stat"><div>${label}${icon(name)}</div><strong>${value}</strong><p>${caption}</p></article>`).join('')}</div>
    <div class="report-layout"><section class="panel report-panel"><div class="panel-heading"><h2>衣橱构成</h2><span>${stats.count} 件</span></div><div class="category-chart">${CATEGORIES.slice(1).map(c=>{const count=state.items.filter(i=>i.category===c).length;return `<div><span>${c}</span><div class="bar-track"><i style="width:${count/maxCategory*100}%"></i></div><strong>${count}</strong></div>`;}).join('')}</div></section><section class="panel report-panel"><div class="panel-heading"><h2>你的衣橱色谱</h2><span>按标记颜色统计</span></div><div class="color-spectrum">${COLORS.map(color=>({ ...color,count:state.items.filter(item=>item.color===color.value).length })).filter(color=>color.count).sort((a,b)=>b.count-a.count).map(color=>`<div><span style="background:${color.value}"></span><strong>${h(color.name)}</strong><small>${color.count} 件</small></div>`).join('') || '<p class="muted">添加衣物后，发现你的专属色谱。</p>'}</div></section></div>
    <section class="report-collection"><div class="section-title"><h2>反复穿，也依然喜欢</h2><span class="muted">穿着最多的单品</span></div>${most.length?`<div class="garment-grid report-grid">${most.map(item=>garmentCard(item)).join('')}</div>`:'<div class="empty-inline">记录穿搭之后，这里会展示你最常穿的衣服。</div>'}</section>
    <section class="report-collection"><div class="section-title"><h2>下一次，穿穿它们</h2><span class="muted">还没被记录过的单品</span></div>${less.length?`<div class="garment-grid report-grid">${less.map(item=>garmentCard(item)).join('')}</div>`:'<div class="empty-inline">每一件衣服都已有穿着记录。</div>'}</section>`;
}

function settingsView() {
  const service=getFlatlayConfig();
  return `${heading('A SPACE OF YOUR OWN','数据与设置','给衣橱起个名字，也给你的收藏留一份备份。')}
    <div class="settings-layout"><section class="panel settings-panel"><h2>我的空间</h2><form id="settings-form"><label class="field">衣橱名称<input name="name" value="${h(state.settings.name)}" maxlength="30" required/></label><button class="button primary" type="submit">保存名称</button></form></section>
    <section class="panel settings-panel"><h2>${icon('lock')} 数据与备份</h2><p>衣物照片、搭配和日记仅保存在当前浏览器。更换设备或清除浏览器数据前，请先导出备份；在其他设备导入即可继续使用。</p><div class="settings-actions">${btn('export-backup','导出完整备份','download','button primary')}${btn('import-backup','导入备份','upload','button')}<input id="backup-file" type="file" accept="application/json,.json" hidden/></div><small>JSON 备份包含照片和全部记录。导入时会先预览数量，再由你确认替换。</small></section>
    <section class="panel settings-panel"><h2>${icon('sparkle')} 衣物平铺 AI</h2><p>生成式图像编辑会去掉人体和姿势，将指定衣物重建为俯视平铺图。选择分类和目标描述后点击生成，再核对面料、图案和细节。普通人体抠图不会参与默认自动搭配。</p><form id="flatlay-settings-form"><label class="field">平铺 AI 服务地址<input name="url" type="url" value="${h(service.url)}" placeholder="https://你的平铺服务.workers.dev"/></label><label class="field">服务访问口令（选填）<input name="token" type="password" value="${h(service.token)}" autocomplete="off" placeholder="代理服务的访问口令，非模型 API Key"/></label><div class="settings-actions"><button type="submit" class="button primary">保存连接设置</button>${btn('flatlay-health','检查连接','refresh','button')}</div><p id="flatlay-service-status" role="status">${service.url?'已设置服务地址，生成前请检查连接。':'尚未连接平铺 AI 服务。'}</p></form><small>生成时原图会发送到你配置的服务，可能产生服务商费用。模型 API Key 应放在后端 .env 或服务密钥设置中，不能写入公开网页。服务访问口令仅保留在当前标签页，不进入衣橱备份。</small></section>
    <section class="panel settings-panel"><h2>重新开始</h2><p>初次使用包含 12 件插画示例，可先尝试搭配。准备好后清空示例，建立自己的衣橱。</p><div class="settings-actions">${btn('reset-demo','恢复示例衣橱','refresh','button')}${btn('clear-all','清空所有数据','trash','button danger')}</div><small>操作前会提示确认。建议先导出备份。</small></section></div>`;
}

function openDialog(title, body, cls = '') {
  closeDialog(false);
  dialogReturnFocus = document.activeElement;
  modalRoot.innerHTML = `<dialog class="modal ${cls}" aria-labelledby="dialog-title"><div class="modal-header"><h2 id="dialog-title">${title}</h2>${btn('close-dialog',icon('close'),'','icon-button','aria-label="关闭弹窗"')}</div>${body}</dialog>`;
  const dialog = modalRoot.querySelector('dialog');
  dialog.addEventListener('cancel',event=>{event.preventDefault();closeDialog();});
  dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)closeDialog();}});
  dialog.showModal();
}

function closeDialog(restore = true) {
  modalRoot.querySelector('dialog')?.close();
  modalRoot.innerHTML = '';
  dialogCleanup?.(); dialogCleanup = null;
  if (restore && dialogReturnFocus?.isConnected) dialogReturnFocus.focus();
}

function confirmDialog(title, description, action, label = '确认', extra = '') {
  openDialog(title,`<div class="confirm-content"><p>${description}</p></div><div class="modal-actions">${btn('close-dialog','取消','','button')}${btn(action,label,'','button primary',extra)}</div>`,'confirmation');
}

function itemDialog(id) {
  const item = state.items.find(item=>item.id===id);
  if (!item) return;
  openDialog(h(item.name),`<div class="detail-layout"><div class="detail-image"><img src="${h(item.image)}" alt="${h(item.name)}"/></div><div class="detail-info"><span class="detail-category">${h(item.category)} / ${h(item.style)}</span><h3>${h(item.name)}</h3><div class="detail-price">¥${money(item.price)}</div><dl><div><dt>品牌</dt><dd>${h(item.brand||'未填写')}</dd></div><div><dt>颜色</dt><dd><i style="background:${item.color}"></i>${h(item.colorName)}</dd></div><div><dt>季节</dt><dd>${item.seasons.join(' · ')||'四季'}</dd></div><div><dt>穿着次数</dt><dd>${item.wearCount} 次</dd></div><div><dt>单次成本</dt><dd>${item.wearCount?`¥${(item.price/item.wearCount).toFixed(1)}`:'尚无记录'}</dd></div></dl>${item.notes?`<p class="detail-notes">${h(item.notes)}</p>`:''}<div class="detail-buttons">${btn('wear-item','记录穿着','calendar','button primary',`data-id="${h(id)}"`)}${btn('edit-item','编辑','edit','button',`data-id="${h(id)}"`)}${btn('delete-item',icon('trash'),'','button danger',`data-id="${h(id)}" aria-label="删除衣物"`)}</div></div></div>`,'wide');
}

function editItemDialog(id = '') {
  const existing = state.items.find(item=>item.id===id);
  const item = existing || { name:'',category:'上装',color:COLORS[0].value,colorName:COLORS[0].name,seasons:['春','秋'],style:STYLES[0],brand:'',price:0,wearCount:0,notes:'',image:'./assets/garments/cotton-shirt.svg' };
  modalImage = item.image; modalOriginal = item.originalImage || item.image;
  modalPhotoSource = isRealPhoto(item) ? 'photo' : 'demo';
  modalCutoutStatus = item.cutoutStatus || 'original';
  modalImageKind = item.imageKind || (isCutoutPhoto(item)?'cutout':'original');
  modalPendingResult = null;
  openDialog(existing?'编辑衣物':'收进一件新衣服',`<form id="item-form" data-id="${h(id)}"><div class="item-form-layout"><div class="photo-upload"><div id="photo-preview"><img src="${h(item.image)}" alt="衣物照片预览"/></div><label class="button upload-label">${icon('upload')}上传衣物照片<input id="item-photo" type="file" accept="image/png,image/jpeg,image/webp" hidden/></label><p>JPG / PNG / WebP · 最大 20 MB<br>透明背景照片更适合搭配</p><button class="text-button" type="button" data-action="remove-white">去除浅色背景</button><button class="text-button muted" type="button" data-action="restore-photo">还原照片</button><small id="photo-status" role="status">${existing?'可替换衣物照片':'未上传时使用示例插画'}</small></div><div class="item-fields"><label class="field">衣物名称 <span>*</span><input name="name" maxlength="80" placeholder="例如：奶油白针织开衫" value="${h(item.name)}" required/></label><div class="form-row"><label class="field">分类<select name="category">${CATEGORIES.slice(1).map(c=>`<option ${c===item.category?'selected':''}>${c}</option>`).join('')}</select></label><label class="field">风格<select name="style">${STYLES.map(s=>`<option ${s===item.style?'selected':''}>${s}</option>`).join('')}</select></label></div><label class="field">颜色<select name="color">${COLORS.map(c=>`<option value="${c.value}" ${c.value===item.color?'selected':''}>${c.name}</option>`).join('')}</select></label><fieldset class="season-field"><legend>适合的季节</legend>${SEASONS.map(s=>`<label><input type="checkbox" name="seasons" value="${s}" ${item.seasons.includes(s)?'checked':''}/><span>${s}</span></label>`).join('')}</fieldset><div class="form-row"><label class="field">品牌<input name="brand" maxlength="80" placeholder="选填" value="${h(item.brand)}"/></label><label class="field">购入价格（元）<input name="price" type="number" min="0" max="10000000" step="0.01" value="${item.price}" required/></label></div><label class="field">已有穿着次数<input name="wearCount" type="number" min="0" max="1000000" step="1" value="${item.wearCount}" required/></label><label class="field">备注<textarea name="notes" rows="2" maxlength="2000" placeholder="材质、尺码，或关于它的小故事…">${h(item.notes)}</textarea></label></div></div><div class="modal-actions">${btn('close-dialog','取消','','button')}<button type="submit" class="button primary">${icon('check')}保存衣物</button></div></form>`,'wide');
  const form=modalRoot.querySelector('#item-form'), controller=new AbortController();
  form.photoController=controller;
  dialogCleanup=()=>controller.abort();
  if(modalPhotoSource==='photo')form.dataset.customPhoto='true';
  const input=form.querySelector('#item-photo'); input.multiple=!existing;
  const zone=form.querySelector('#photo-preview');zone.dataset.uploadDrop='single';zone.classList.add('single-photo-drop');
  const aiButton=form.querySelector('[data-action="remove-white"]');
  aiButton.dataset.action='ai-flatlay';aiButton.textContent='生成平铺衣物';aiButton.disabled=modalPhotoSource!=='photo';
  const status=form.querySelector('#photo-status');
  status.textContent=modalPhotoSource==='photo'?(modalImageKind==='flatlay'?'已确认平铺图 · 原图已保留':'照片已保留，请选择目标分类后生成平铺图'):'先上传照片，再选择需要提取的衣物分类';
  form.querySelector('.photo-upload>p').innerHTML='JPG / PNG / WebP · 最大 20 MB<br>也支持拖入照片，多张自动批量处理';
  status.insertAdjacentHTML('afterend',`<div class="flatlay-review" id="single-flatlay-review" hidden><p>请确认已去掉人体，只剩目标衣物，且为完整的平铺展示。</p>${btn('confirm-flatlay','确认平铺结果','check','button primary')}</div>`);
  form.querySelector('.item-fields').insertAdjacentHTML('afterbegin',`<label class="field">要提取的衣物（选填）<input name="targetDescription" maxlength="300" placeholder="例如：人物身上的蓝色长袖衬衫，不要外套"/><small>多件衣服时，请用颜色、款式或位置指明目标。</small></label>`);
  if(modalCutoutStatus==='done')zone.classList.add('checkerboard');
}

async function processSinglePhoto(input, form) {
  if (!form?.isConnected || form.dataset.photoBusy==='true') return;
  const controller=form.photoController;
  const status=form.querySelector('#photo-status');
  photoBusy(form,true);
  try {
    status.textContent='正在读取照片…';
    const original=typeof input==='string'?input:await readImageFile(input);
    if(!form.isConnected || controller.signal.aborted)return;
    modalOriginal=original;modalImage=original;modalPhotoSource='photo';modalCutoutStatus='original';modalImageKind='original';modalPendingResult=null;
    form.dataset.customPhoto='true';form.querySelector('#photo-preview img').src=original;
    form.querySelector('#photo-preview').classList.remove('checkerboard');
    form.querySelector('#single-flatlay-review').hidden=true;
    status.textContent='照片已准备好。选择要提取的分类，再点击“生成平铺衣物”。';
    status.classList.remove('upload-error');
  } catch(error) {
    if(error.name!=='AbortError' && form.isConnected){status.textContent=error.message;status.classList.add('upload-error');toast('照片读取未完成，请检查图片或重试。');}
  } finally {
    if(form.isConnected){photoBusy(form,false);form.querySelector('[data-action="ai-flatlay"]').disabled=modalPhotoSource!=='photo';}
  }
}

async function finishFlatlayImage(result,{signal,onProgress}={}) {
  const image=await loadedImage(result.image);
  if(signal?.aborted)throw new DOMException('已取消处理','AbortError');
  const scale=Math.min(1,1200/Math.max(image.naturalWidth,image.naturalHeight));
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
  const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(image,0,0,canvas.width,canvas.height);
  const pixels=context.getImageData(0,0,canvas.width,canvas.height).data;let transparent=0;
  for(let i=3;i<pixels.length;i+=4)if(pixels[i]<16)transparent++;
  const png=canvas.toDataURL('image/png');
  if(transparent>canvas.width*canvas.height*.03)return {...result,image:png};
  const cutout=await removeBackground(png,{signal,onProgress:progress=>onProgress?.({...progress,message:'平铺已生成，正在整理透明边缘…',percent:80+(progress.percent||0)*.2})});
  return {...result,image:cutout};
}

async function generateSingleFlatlay(form) {
  if(!form?.isConnected||form.dataset.photoBusy==='true'||modalPhotoSource!=='photo')return;
  const category=form.querySelector('[name="category"]').value;
  const description=form.querySelector('[name="targetDescription"]').value;
  const controller=form.photoController,status=form.querySelector('#photo-status');
  photoBusy(form,true);
  try {
    const progress=value=>{if(form.isConnected&&!controller.signal.aborted)status.textContent=value.message;};
    const result=await generateFlatlay(modalOriginal,{category,targetDescription:description,signal:controller.signal,onProgress:progress});
    const finalized=await finishFlatlayImage(result,{signal:controller.signal,onProgress:progress});
    if(!form.isConnected||controller.signal.aborted)return;
    modalImage=finalized.image;modalPendingResult={...finalized,category,targetDescription:description};
    form.querySelector('#photo-preview img').src=modalImage;form.querySelector('#photo-preview').classList.add('checkerboard');
    form.querySelector('#single-flatlay-review').hidden=false;
    status.textContent='已生成，待你确认平铺效果。原图已保留。';status.classList.remove('upload-error');
  }catch(error){if(error.name!=='AbortError'&&form.isConnected){status.textContent=error.message;status.classList.add('upload-error');}}
  finally{if(form.isConnected){photoBusy(form,false);form.querySelector('[type="submit"]').disabled=Boolean(modalPendingResult&&!modalPendingResult.confirmed);}}
}

function invalidateSingleResult(form) {
  if(!form?.isConnected)return;
  modalImage=modalOriginal;modalCutoutStatus='original';modalImageKind='original';modalPendingResult=null;
  form.querySelector('#photo-preview img').src=modalImage;form.querySelector('#photo-preview').classList.remove('checkerboard');
  form.querySelector('#single-flatlay-review').hidden=true;form.querySelector('[type="submit"]').disabled=false;
  form.querySelector('#photo-status').textContent='目标衣物已改变，请重新生成对应的平铺图。';
}

function newUploadRow(file, existing = null) {
  return { id:uid(), file, targetItemId:existing?.id, image:'',originalImage:existing?.originalImage||existing?.image||'', status:'queued',progress:0,message:'待处理',error:'',selected:true,cutoutStatus:'original',imageKind:'original',targetDescription:'',result:null,
    phase:'prepare',meta: existing ? structuredClone(existing) : {name:photoName(file.name),category:guessCategory(file.name),color:COLORS[0].value,colorName:COLORS[0].name,seasons:[...SEASONS],style:STYLES[0],brand:'',price:0,wearCount:0,favorite:false,notes:''} };
}

function openUploadDialog(files = [], existing = []) {
  openDialog('批量生成平铺衣物',`<div id="batch-upload"><div class="batch-intro"><p>先确认要提取的分类和目标，再让 AI 去掉人体并重建平铺衣物。</p><small>原图会发送到你配置的 AI 服务 · 每批最多 30 张 · 保留原图</small></div><label id="upload-dropzone" class="batch-dropzone" data-upload-drop="batch" tabindex="0">${icon('upload')}<strong>拖入穿着照片，或点击选择多张</strong><span>JPG / PNG / WebP · 每张最大 20 MB</span><input id="batch-files" type="file" accept="image/png,image/jpeg,image/webp" multiple hidden/></label><div class="batch-common"><label class="field">本批新衣物的风格<select id="batch-style">${STYLES.map(style=>`<option>${style}</option>`).join('')}</select></label><fieldset class="season-field"><legend>适合季节</legend>${SEASONS.map(s=>`<label><input type="checkbox" name="batch-seasons" value="${s}" checked/><span>${s}</span></label>`).join('')}</fieldset></div><div id="batch-notices" role="status"></div><div class="batch-summary"><strong id="batch-summary">尚未选择照片</strong><span>${btn('batch-generate','生成所选平铺图','sparkle','button primary','disabled')}${btn('batch-stop','暂停','','text-button')}${btn('batch-resume','继续处理','refresh','text-button')}${btn('batch-retry-all','重试失败项','refresh','text-button')}</span></div><div id="batch-rows"></div><div class="batch-hint">每张生成图请确认：没有人体、只有目标衣物、已经平铺，且颜色、图案和细节相符，再收进衣橱。遮挡处会由 AI 补全，重试可能产生额外服务调用。关闭窗口会放弃尚未保存的照片。</div></div><div class="modal-actions"><span id="batch-ready-count"></span>${btn('close-dialog','取消','','button')}${btn('batch-save','收进衣橱','check','button primary','disabled')}</div>`,'wide batch-modal');
  const session={id:uid(),rows:existing.slice(0,30).map(item=>newUploadRow(null,item)),busy:false,saving:false,stopped:false,closed:false,controller:null};
  uploadSession=session;
  dialogCleanup=()=>{session.closed=true;session.controller?.abort();if(uploadSession===session)uploadSession=null;};
  renderUploadRows(session);
  if(files.length)addUploadFiles(files,session);
  else if(session.rows.length)runUploadQueue(session);
}

function uploadRowHtml(row) {
  return `<article class="batch-row" data-id="${row.id}"><label class="batch-select"><input type="checkbox" data-upload-field="selected" data-row="${row.id}" ${row.selected?'checked':''} aria-label="选择 ${h(row.meta.name)}"/></label><div class="batch-thumbnail checkerboard">${row.image||row.originalImage?`<img src="${h(row.image||row.originalImage)}" alt="${h(row.meta.name)}"/>`:icon('shirt')}</div><div class="batch-row-info"><div class="batch-row-fields"><input data-upload-field="name" data-row="${row.id}" value="${h(row.meta.name)}" maxlength="80" aria-label="衣物名称"/><select data-upload-field="category" data-row="${row.id}" aria-label="要提取的衣物分类">${CATEGORIES.slice(1).map(category=>`<option ${row.meta.category===category?'selected':''}>${category}</option>`).join('')}</select><select data-upload-field="color" data-row="${row.id}" aria-label="衣物颜色">${COLORS.map(color=>`<option value="${color.value}" ${row.meta.color===color.value?'selected':''}>${color.name}</option>`).join('')}</select><input class="batch-target" data-upload-field="targetDescription" data-row="${row.id}" value="${h(row.targetDescription)}" maxlength="300" placeholder="目标：如蓝色衬衫，不要外套（选填）" aria-label="目标衣物描述"/></div><div class="batch-row-status" role="status"></div><div class="batch-row-progress"><i></i></div><div class="batch-row-actions">${btn('batch-row-confirm','确认平铺结果','check','text-button',`data-row="${row.id}" hidden`)}${btn('batch-row-retry','生成平铺图','sparkle','text-button',`data-row="${row.id}"`)}${btn('batch-row-original','保留原图','','text-button muted',`data-row="${row.id}"`)}${btn('batch-row-compare','查看原图','','text-button muted',`data-row="${row.id}"`)}</div></div>${btn('batch-row-remove',icon('close'),'','icon-button',`data-row="${row.id}" aria-label="移除 ${h(row.meta.name)}"`)}</article>`;
}

function renderUploadRows(session) {
  if(session.closed || uploadSession!==session)return;
  document.querySelector('#batch-rows').innerHTML=session.rows.map(uploadRowHtml).join('');
  session.rows.forEach(row=>updateUploadRow(row,session));
  updateUploadSummary(session);
}

function updateUploadRow(row,session) {
  if(session.closed || uploadSession!==session || row.removed)return;
  const element=document.querySelector(`.batch-row[data-id="${row.id}"]`);if(!element)return;
  element.dataset.status=row.status;
  const labels={queued:'待处理',reading:'正在读取照片',prepared:'原图已准备好，请选择目标后生成',processing:'AI 正在去人并重建平铺',review:'已生成平铺图，待确认',ready:row.imageKind==='flatlay'?'平铺结果已确认':'已选择保留原图',error:'处理失败',paused:'已暂停'};
  const status=element.querySelector('.batch-row-status');
  status.textContent=row.error || (['reading','processing'].includes(row.status)?`${row.message} ${Math.round(row.progress)}%`:labels[row.status]);
  status.classList.toggle('upload-error',row.status==='error');
  element.querySelector('.batch-row-progress i').style.width=`${row.status==='ready'?100:row.progress}%`;
  const thumbnail=element.querySelector('.batch-thumbnail');
  const source=row.showOriginal?row.originalImage:row.image||row.originalImage;
  if(source){let image=thumbnail.querySelector('img');if(!image){thumbnail.innerHTML='';image=document.createElement('img');thumbnail.append(image);}image.src=source;image.alt=row.meta.name;}
  const busy=['processing','reading'].includes(row.status);
  element.querySelector('[data-action="batch-row-retry"]').disabled=busy||row.status==='queued';
  element.querySelector('[data-action="batch-row-confirm"]').hidden=row.status!=='review';
  element.querySelector('[data-action="batch-row-retry"]').textContent=row.result?'重新生成':'生成平铺图';
  element.querySelector('[data-upload-field="category"]').disabled=busy||session.saving;
  element.querySelector('[data-upload-field="targetDescription"]').disabled=busy||session.saving;
  element.querySelector('[data-action="batch-row-original"]').disabled=!row.originalImage||busy;
  element.querySelector('[data-action="batch-row-compare"]').disabled=!row.originalImage;
  element.querySelector('[data-action="batch-row-compare"]').textContent=row.showOriginal?'查看生成图':'查看原图';
}

function updateUploadSummary(session) {
  if(session.closed||uploadSession!==session)return;
  const ready=session.rows.filter(row=>row.status==='ready'), selected=ready.filter(row=>row.selected), failed=session.rows.filter(row=>row.status==='error');
  const review=session.rows.filter(row=>row.status==='review').length;
  document.querySelector('#batch-summary').textContent=session.rows.length?`已确认 ${ready.length} / ${session.rows.length} 件${review?` · ${review} 件待确认`:''}${failed.length?` · ${failed.length} 件失败`:''}`:'尚未选择照片';
  document.querySelector('#batch-ready-count').textContent=selected.length?`已选 ${selected.length} 件`:'确认预览后一起保存';
  document.querySelector('[data-action="batch-save"]').disabled=session.busy||session.saving||saving||!selected.length;
  document.querySelector('[data-action="batch-generate"]').disabled=session.busy||session.saving||!session.rows.some(row=>row.selected&&['prepared','error','paused'].includes(row.status)&&row.originalImage);
  document.querySelector('[data-action="batch-stop"]').hidden=!session.busy;
  document.querySelector('[data-action="batch-resume"]').hidden=session.busy||!session.rows.some(row=>['queued','paused'].includes(row.status));
  document.querySelector('[data-action="batch-retry-all"]').hidden=session.busy||!failed.length;
}

function addUploadFiles(files, session=uploadSession) {
  if(!session || session.closed)return;
  if(session.saving){toast('正在保存，请稍候再添加照片。');return;}
  const checked=inspectFiles(files,session.rows.filter(row=>row.file&&!row.removed).map(row=>row.file));
  const remaining=Math.max(0,30-session.rows.length);
  const accepted=checked.accepted.slice(0,remaining);
  const extra=checked.accepted.slice(remaining).map(file=>({file,error:'每批最多处理 30 件衣物。'}));
  const notices=[...checked.rejected,...extra].map(({file,error})=>`${file.name}：${error}`);
  if(checked.duplicates.length)notices.push(`已跳过 ${checked.duplicates.length} 张重复照片。`);
  document.querySelector('#batch-notices').textContent=notices.join(' ');
  session.rows.push(...accepted.map(file=>newUploadRow(file)));
  renderUploadRows(session);
  if(!session.stopped)runUploadQueue(session);
}

async function runUploadQueue(session) {
  if(session.busy||session.saving||session.closed)return;
  session.busy=true;session.stopped=false;session.controller=new AbortController();
  session.rows.forEach(row=>{if(row.status==='paused')row.status='queued';});
  updateUploadSummary(session);
  try {
    while(!session.closed&&!session.stopped){
      const row=session.rows.find(row=>row.status==='queued'&&!row.removed);if(!row)break;
      try{
        row.status='reading';row.progress=2;row.message='正在读取照片';row.error='';updateUploadRow(row,session);
        if(!row.originalImage)row.originalImage=await readImageFile(row.file);
        if(session.closed||session.stopped||row.removed){if(!row.removed)row.status='paused';continue;}
        if(row.phase==='prepare'){
          row.image=row.originalImage;row.status='prepared';row.progress=100;row.imageKind='original';row.cutoutStatus='original';
        }else{
          row.status='processing';row.message='AI 正在去掉人体并生成平铺';updateUploadRow(row,session);
          const category=row.meta.category,targetDescription=row.targetDescription;
          const progress=value=>{row.progress=value.percent||0;row.message=value.message;updateUploadRow(row,session);};
          const generated=await generateFlatlay(row.originalImage,{category,targetDescription,signal:session.controller.signal,onProgress:progress});
          const result=await finishFlatlayImage(generated,{signal:session.controller.signal,onProgress:progress});
          if(session.closed||session.stopped||row.removed){if(!row.removed)row.status='paused';continue;}
          row.image=result.image;row.result={...result,category,targetDescription};row.status='review';row.progress=100;row.showOriginal=false;
        }
      }catch(error){if(error.name==='AbortError'||session.stopped)row.status='paused';else{row.status='error';row.error=error.message||'照片处理失败，可重试。';}}
      updateUploadRow(row,session);updateUploadSummary(session);
    }
  }finally{session.busy=false;updateUploadSummary(session);}
}

async function saveUploadBatch(session=uploadSession) {
  if(!session||session.closed||session.busy||session.saving||saving)return;
  const rows=session.rows.filter(row=>row.selected&&row.status==='ready');
  if(!rows.length){toast('请选择已处理完成的照片。');return;}
  if(rows.some(row=>!row.meta.name.trim())){toast('请为所选衣物填写名称。');return;}
  const style=document.querySelector('#batch-style').value;
  const seasons=[...document.querySelectorAll('[name="batch-seasons"]:checked')].map(input=>input.value);
  const next=structuredClone(state);let added=0,updated=0;
  for(const row of rows){
    const existing=row.targetItemId?next.items.find(item=>item.id===row.targetItemId):null;
    if(row.targetItemId&&!existing){toast('部分衣物已被其他窗口删除，请关闭并重新处理。');return;}
    const item={...(existing||row.meta),id:existing?.id||uid(),name:row.meta.name.trim(),category:row.meta.category,color:row.meta.color,colorName:COLORS.find(c=>c.value===row.meta.color)?.name||row.meta.colorName,
      seasons:existing?existing.seasons:seasons,style:existing?existing.style:style,source:'photo',cutoutStatus:row.cutoutStatus,imageKind:row.imageKind,imageSource:row.imageKind==='flatlay'?'generated':'local',originalImage:row.originalImage,image:row.image,
      createdAt:existing?.createdAt||new Date().toISOString(),brand:existing?.brand??row.meta.brand??'',price:existing?.price??row.meta.price??0,wearCount:existing?.wearCount??row.meta.wearCount??0,favorite:existing?.favorite??row.meta.favorite??false,notes:existing?.notes??row.meta.notes??''};
    if(row.imageKind==='flatlay'&&row.result){item.imageProvider=row.result.provider;item.imageModel=row.result.model;item.processedAt=new Date().toISOString();if(existing)Object.assign(existing,item);}
    if(row.imageKind!=='flatlay'){for(const key of ['imageProvider','imageModel','processedAt']){delete item[key];if(existing)delete existing[key];}}
    if(existing){Object.assign(existing,item);updated++;}else{next.items.unshift(item);added++;}
  }
  if(next.items.length>3000){toast('衣橱最多保存 3000 件衣物，请先整理现有衣物。');return;}
  session.saving=true;
  document.querySelectorAll('#batch-upload input,#batch-upload select,#batch-upload button').forEach(element=>{element.disabled=true;});
  document.querySelector('[data-action="batch-save"]').disabled=true;
  try {
    if(await commit(next,`${added?`已收进 ${added} 件衣物`:`已处理 ${updated} 件衣物`}，已确认的平铺图可用于自动搭配。`)){
      if(session.closed||uploadSession!==session)return;
      const selectedIds=new Set(rows.map(row=>row.id));session.rows=session.rows.filter(row=>!selectedIds.has(row.id));
      if(!session.rows.length)closeDialog();else{renderUploadRows(session);toast('所选衣物已保存，其余照片可继续处理。');}
    }
  } finally {
    session.saving=false;
    if(!session.closed&&uploadSession===session){
      document.querySelectorAll('#batch-upload input,#batch-upload select,#batch-upload button').forEach(element=>{element.disabled=false;});
      session.rows.forEach(row=>updateUploadRow(row,session));updateUploadSummary(session);
    }
  }
}

function diaryDialog(itemIds = [], name = '', outfitId = '') {
  if (!state.items.length) { toast('先添加衣物，再记录穿搭。'); return; }
  const date = ui.route==='calendar'?ui.selectedDate:today();
  openDialog('记录这一天的穿搭',`<form id="diary-form" data-outfit="${h(outfitId)}"><div class="diary-form-fields"><div class="form-row"><label class="field">日期<input name="date" type="date" value="${date}" required/></label><label class="field">穿搭名称<input name="name" value="${h(name)}" maxlength="80" placeholder="例如：周末散步" required/></label></div><label class="field">心情与备注<textarea name="notes" rows="2" maxlength="2000" placeholder="今天去了哪里，穿着感觉怎么样？"></textarea></label><div class="field-label">选出今天穿过的衣物 <span>*</span></div><div class="diary-pick-grid">${state.items.map(item=>`<label class="diary-pick"><input name="itemIds" type="checkbox" value="${h(item.id)}" ${itemIds.includes(item.id)?'checked':''}/><span><img src="${h(item.image)}" alt=""/><strong>${h(item.name)}</strong><i>${icon('check')}</i></span></label>`).join('')}</div><p class="muted form-hint">保存后，每件所选衣物的穿着次数会增加 1 次。</p></div><div class="modal-actions">${btn('close-dialog','取消','','button')}<button type="submit" class="button primary">${icon('check')}保存记录</button></div></form>`,'wide');
}

function suggestionDialog() {
  const photos=state.items.filter(isRealPhoto).length,processed=state.items.filter(isProcessedPhoto).length;
  openDialog('用平铺衣物搭一套',`<form id="suggestion-form"><div class="suggestion-content"><div class="suggestion-icon">${icon('sparkle')}</div><p>从已确认的平铺衣物中，按季节、风格和颜色组合出搭配，直接使用保存的衣物图。</p><div class="real-photo-count">${processed} 件平铺衣物 / ${photos} 件真实照片</div><div class="form-row"><label class="field">适合的季节<select name="season">${SEASONS.map(s=>`<option ${s==='秋'?'selected':''}>${s}</option>`).join('')}</select></label><label class="field">今天的风格<select name="style">${['全部风格',...STYLES].map(s=>`<option>${s}</option>`).join('')}</select></label></div><small>请先准备平铺上装和下装，或一件平铺连衣裙。含人体的抠图和示例插画不会参与自动搭配。</small>${!processed?`<div class="suggestion-upload">${btn(photos?'batch-existing':'batch-open',photos?'生成已有照片的平铺图':'上传真实衣物','upload','button')}</div>`:''}<p id="suggestion-status" role="status"></p></div><div class="modal-actions">${btn('close-dialog','取消','','button')}<button type="submit" class="button primary">${icon('sparkle')}自动搭配</button></div></form>`);
}

function setDraft(outfit) {
  ui.draft = { ...structuredClone(outfit), elements: outfit.elements.map(element=>({...element,key:uid()})) };
  ui.selected = null;
  navigate('studio');
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

function exportBackup() {
  downloadBlob(new Blob([JSON.stringify(state,null,2)],{type:'application/json'}),`衣间备份-${today()}.json`);
  toast('备份已导出，记得收好这个文件。');
}

async function readImageFile(file) {
  const error=imageFileError(file);if(error)throw new Error(error);
  let bitmap;
  try { bitmap = await createImageBitmap(file); }
  catch { throw new Error('无法读取这张照片，文件可能已损坏，请重新选择。'); }
  const ratio = Math.min(1,1200/Math.max(bitmap.width,bitmap.height));
  const canvas = document.createElement('canvas'); canvas.width = Math.max(1,Math.round(bitmap.width*ratio)); canvas.height = Math.max(1,Math.round(bitmap.height*ratio));
  canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height); bitmap.close();
  return canvas.toDataURL('image/png');
}

function photoBusy(form, busy) {
  form.dataset.photoBusy = busy ? 'true' : '';
  form.querySelectorAll('button[type="submit"], .photo-upload button, .photo-upload input, [name="category"], [name="targetDescription"]').forEach(element => { element.disabled = busy; });
  if(!busy&&form.id==='item-form')form.querySelector('[type="submit"]').disabled=Boolean(modalPendingResult&&!modalPendingResult.confirmed);
}

async function loadedImage(source) {
  const image = new Image(); image.src=source;
  await image.decode(); return image;
}

async function exportOutfit() {
  if(!ui.draft.elements.length){toast('先在画布中添加衣物。');return;}
  const draft = structuredClone(ui.draft);
  const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=1400;
  const context=canvas.getContext('2d');context.scale(2,2);context.fillStyle=draft.background;context.fillRect(0,0,640,700);
  for(const element of [...draft.elements].sort((a,b)=>a.z-b.z)){
    const item=state.items.find(item=>item.id===element.itemId);if(!item)continue;
    const image=await loadedImage(item.image), ratio=Math.min(element.width/image.naturalWidth,element.width/image.naturalHeight);
    const w=image.naturalWidth*ratio,height=image.naturalHeight*ratio;
    context.save();context.translate(element.x,element.y);context.rotate(element.rotation*Math.PI/180);context.drawImage(image,-w/2,-height/2,w,height);context.restore();
  }
  context.fillStyle='#526156';context.font='12px sans-serif';context.textAlign='center';context.fillText('衣间 / YOUR EVERYDAY EDIT',320,682);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
  if(!blob)throw new Error('图片生成失败，请重试。');
  downloadBlob(blob,`${(draft.name||'我的搭配').replace(/[\\/:*?"<>|]/g,'-')}.png`);toast('搭配图片已导出。');
}

function bindStudioPointer() {
  const board = document.querySelector('#canvas-board');
  board?.addEventListener('pointerdown',event=>{
    const target=event.target.closest('[data-element]');
    if(!target || event.button!==0)return;
    const key=target.dataset.element, element=ui.draft.elements.find(e=>e.key===key);if(!element)return;
    ui.selected=key;
    board.querySelectorAll('.canvas-element').forEach(el=>el.classList.toggle('selected',el===target));
    document.querySelector('.selection-controls')?.classList.remove('disabled');
    for(const id of ['element-size','element-rotation']){const input=document.getElementById(id);input.disabled=false;input.value=id==='element-size'?element.width:element.rotation;}
    document.querySelectorAll('.selection-controls button').forEach(button=>button.disabled=false);
    target.setPointerCapture(event.pointerId);
    const startX=event.clientX,startY=event.clientY,x=element.x,y=element.y, rect=board.getBoundingClientRect();
    const move=e=>{element.x=Math.max(0,Math.min(640,x+(e.clientX-startX)/rect.width*640));element.y=Math.max(0,Math.min(700,y+(e.clientY-startY)/rect.height*700));target.style.left=`${element.x/640*100}%`;target.style.top=`${element.y/700*100}%`;};
    const end=()=>{target.removeEventListener('pointermove',move);target.removeEventListener('pointerup',end);target.removeEventListener('pointercancel',end);};
    target.addEventListener('pointermove',move);target.addEventListener('pointerup',end);target.addEventListener('pointercancel',end);
  });
}

async function act(action, element) {
  const id=element.dataset.id;
  if(action.startsWith('batch-')&&uploadSession?.saving){toast('正在保存，请稍候再操作。');return;}
  switch(action) {
    case 'go-settings': navigate('settings');break;
    case 'go-studio': navigate('studio');break;
    case 'go-calendar': ui.selectedDate=today();ui.month=today().slice(0,7);navigate('calendar');break;
    case 'add-item': editItemDialog();break;
    case 'batch-open': openUploadDialog();break;
    case 'batch-existing': openUploadDialog([],state.items.filter(item=>isRealPhoto(item)&&!isProcessedPhoto(item)));break;
    case 'batch-save': await saveUploadBatch();break;
    case 'batch-generate': if(uploadSession){uploadSession.rows.forEach(row=>{if(row.selected&&row.originalImage&&['prepared','error','paused'].includes(row.status)){row.phase='generate';row.status='queued';row.error='';row.progress=0;}});renderUploadRows(uploadSession);await runUploadQueue(uploadSession);}break;
    case 'batch-stop': if(uploadSession){uploadSession.stopped=true;uploadSession.controller?.abort();uploadSession.rows.forEach(row=>{if(row.status==='queued')row.status='paused';});renderUploadRows(uploadSession);}break;
    case 'batch-resume': if(uploadSession)await runUploadQueue(uploadSession);break;
    case 'batch-retry-all': if(uploadSession){uploadSession.rows.forEach(row=>{if(row.status==='error'){row.status='queued';row.error='';row.progress=0;}});renderUploadRows(uploadSession);await runUploadQueue(uploadSession);}break;
    case 'batch-row-remove': if(uploadSession){const row=uploadSession.rows.find(row=>row.id===element.dataset.row);if(row)row.removed=true;uploadSession.rows=uploadSession.rows.filter(row=>row.id!==element.dataset.row);renderUploadRows(uploadSession);}break;
    case 'batch-row-retry': if(uploadSession){const row=uploadSession.rows.find(row=>row.id===element.dataset.row);if(row){row.phase=row.originalImage?'generate':'prepare';row.status='queued';row.error='';row.progress=0;row.showOriginal=false;updateUploadRow(row,uploadSession);if(!uploadSession.busy)await runUploadQueue(uploadSession);}}break;
    case 'batch-row-confirm': if(uploadSession){const row=uploadSession.rows.find(row=>row.id===element.dataset.row);if(row?.result&&row.status==='review'){row.status='ready';row.imageKind='flatlay';row.cutoutStatus='done';updateUploadRow(row,uploadSession);updateUploadSummary(uploadSession);}}break;
    case 'batch-row-original': if(uploadSession){const row=uploadSession.rows.find(row=>row.id===element.dataset.row);if(row?.originalImage){row.image=row.originalImage;row.cutoutStatus='original';row.imageKind='original';row.result=null;row.status='ready';row.error='';row.progress=100;row.showOriginal=false;updateUploadRow(row,uploadSession);updateUploadSummary(uploadSession);}}break;
    case 'batch-row-compare': if(uploadSession){const row=uploadSession.rows.find(row=>row.id===element.dataset.row);if(row){row.showOriginal=!row.showOriginal;updateUploadRow(row,uploadSession);}}break;
    case 'item-detail': itemDialog(id);break;
    case 'edit-item': editItemDialog(id);break;
    case 'close-dialog': closeDialog();break;
    case 'favorite': {const next=structuredClone(state),item=next.items.find(item=>item.id===id);if(item){item.favorite=!item.favorite;await commit(next);}break;}
    case 'filter-category': ui.category=element.dataset.category;render();break;
    case 'filter-favorite': ui.favorite=!ui.favorite;render();break;
    case 'reset-filters': ui.category='全部';ui.season='全部季节';ui.style='全部风格';ui.favorite=false;ui.search='';render();break;
    case 'delete-item': confirmDialog('删除这件衣物？','它也会从已存搭配和穿搭记录中移除。仅包含它的搭配或日记也会删除。','confirm-delete-item','删除衣物',`data-id="${h(id)}"`);break;
    case 'confirm-delete-item': if(await commit(deleteItem(state,id),'衣物已删除。'))closeDialog();break;
    case 'wear-item': diaryDialog([id],state.items.find(item=>item.id===id)?.name);break;
    case 'start-suggestion': case 'suggestion': suggestionDialog();break;
    case 'studio-add': {if(ui.draft.elements.length>=30){toast('一套搭配最多放入 30 件衣物。');break;}const item=state.items.find(i=>i.id===id);if(item){const el={...layoutOutfit([item])[0],key:uid(),z:Math.max(0,...ui.draft.elements.map(e=>e.z))+1};ui.draft.elements.push(el);ui.selected=el.key;render();}break;}
    case 'clear-draft': if(ui.draft.elements.length)confirmDialog('清空当前画布？','当前还未保存的修改将被清除。','confirm-clear-draft','清空画布');break;
    case 'confirm-clear-draft': ui.draft={name:'',background:'#f3f0e9',elements:[]};ui.selected=null;closeDialog();render();break;
    case 'element-front': {const selected=ui.draft.elements.find(e=>e.key===ui.selected);if(selected){const ordered=[...ui.draft.elements].sort((a,b)=>a.z-b.z);ordered.forEach((e,index)=>{e.z=index;});selected.z=ordered.length;render();}break;}
    case 'element-remove': ui.draft.elements=ui.draft.elements.filter(e=>e.key!==ui.selected);ui.selected=null;render();break;
    case 'save-outfit': {if(!ui.draft.elements.length){toast('先添加衣物，再保存搭配。');break;}const next=structuredClone(state),outfit={id:ui.draft.id||uid(),name:ui.draft.name.trim()||`我的搭配 ${state.outfits.length+1}`,background:ui.draft.background,elements:ui.draft.elements.map(({key,...e})=>e),createdAt:new Date().toISOString()};const index=next.outfits.findIndex(o=>o.id===outfit.id);if(index>=0)next.outfits[index]=outfit;else next.outfits.unshift(outfit);if(await commit(next,'搭配已收藏。'))ui.draft.id=outfit.id;break;}
    case 'load-outfit': {const outfit=state.outfits.find(o=>o.id===id);if(outfit){setDraft(outfit);window.scrollTo({top:0,behavior:'smooth'});}break;}
    case 'delete-outfit': confirmDialog('删除这套搭配？','穿搭日历中的记录会保留。','confirm-delete-outfit','删除搭配',`data-id="${h(id)}"`);break;
    case 'confirm-delete-outfit': {const next=structuredClone(state);next.outfits=next.outfits.filter(o=>o.id!==id);if(await commit(next,'搭配已删除。')){if(ui.draft.id===id)delete ui.draft.id;closeDialog();}break;}
    case 'wear-outfit': {const outfit=state.outfits.find(o=>o.id===id);if(outfit)diaryDialog([...new Set(outfit.elements.map(e=>e.itemId))],outfit.name,id);break;}
    case 'export-outfit': await exportOutfit();break;
    case 'add-diary': diaryDialog();break;
    case 'select-date': ui.selectedDate=element.dataset.date;render();break;
    case 'month-prev': case 'month-next': {const [year,month]=ui.month.split('-').map(Number),date=new Date(year,month-1+(action==='month-next'?1:-1),1);ui.month=`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;ui.selectedDate=`${ui.month}-01`;render();break;}
    case 'month-today': ui.month=today().slice(0,7);ui.selectedDate=today();render();break;
    case 'delete-diary': confirmDialog('删除这次穿搭记录？','相关衣物的穿着次数会减少 1 次。','confirm-delete-diary','删除记录',`data-id="${h(id)}"`);break;
    case 'confirm-delete-diary': if(await commit(removeDiary(state,id),'穿搭记录已删除。'))closeDialog();break;
    case 'export-backup': exportBackup();break;
    case 'import-backup': document.querySelector('#backup-file').click();break;
    case 'clear-all': confirmDialog('清空所有数据？','衣物照片、搭配与穿搭日记都会删除。请确认已经导出需要保留的备份。','confirm-clear-all','清空数据');break;
    case 'confirm-clear-all': {if(await commit({version:1,items:[],outfits:[],diary:[],settings:{...state.settings}},'衣橱已清空。')){ui.draft={name:'',background:'#f3f0e9',elements:[]};closeDialog();}break;}
    case 'reset-demo': confirmDialog('恢复示例衣橱？','当前数据会被 12 件示例衣物替换。请先导出需要保留的备份。','confirm-reset-demo','恢复示例');break;
    case 'confirm-reset-demo': if(await commit(seedState(),'示例衣橱已恢复。')){ui.draft={name:'',background:'#f3f0e9',elements:[]};closeDialog();}break;
    case 'ai-flatlay': await generateSingleFlatlay(modalRoot.querySelector('#item-form'));break;
    case 'confirm-flatlay': if(modalPendingResult){modalPendingResult.confirmed=true;modalImageKind='flatlay';modalCutoutStatus='done';document.querySelector('#single-flatlay-review').hidden=true;document.querySelector('#item-form [type="submit"]').disabled=false;document.querySelector('#photo-status').textContent='平铺结果已确认，可以保存并用于自动搭配。';}break;
    case 'restore-photo': modalImage=modalOriginal;modalCutoutStatus='original';modalImageKind='original';modalPendingResult=null;document.querySelector('#photo-preview img').src=modalImage;document.querySelector('#photo-preview').classList.remove('checkerboard');document.querySelector('#single-flatlay-review').hidden=true;document.querySelector('#item-form [type="submit"]').disabled=false;document.querySelector('#photo-status').textContent='已还原为原图，可重新生成平铺图。';break;
    case 'flatlay-health': {const status=document.querySelector('#flatlay-service-status');if(!status)break;status.textContent='正在检查连接…';try{const health=await checkFlatlayService();if(status.isConnected)status.textContent=health.enabled?`连接可用：${health.provider} / ${health.model}`:'服务已连接，尚未配置模型密钥或访问口令。';}catch(error){if(status.isConnected)status.textContent=error.message;}break;}
  }
}

document.addEventListener('click',event=>{
  const element=event.target.closest('[data-action]');if(!element)return;
  act(element.dataset.action,element).catch(error=>toast(error.message||'操作失败，请重试。'));
});

document.addEventListener('dragover',event=>{
  if(!Array.from(event.dataTransfer?.types||[]).includes('Files'))return;
  event.preventDefault();event.dataTransfer.dropEffect='copy';
  event.target.closest('[data-upload-drop]')?.classList.add('drag-active');
});
document.addEventListener('dragleave',event=>{
  const zone=event.target.closest('[data-upload-drop]');
  if(zone&&!zone.contains(event.relatedTarget))zone.classList.remove('drag-active');
});
document.addEventListener('drop',event=>{
  if(!Array.from(event.dataTransfer?.types||[]).includes('Files'))return;
  event.preventDefault();document.querySelectorAll('.drag-active').forEach(element=>element.classList.remove('drag-active'));
  const files=[...event.dataTransfer.files];if(!files.length){toast('请拖入图片文件，暂不支持文件夹。');return;}
  const form=modalRoot.querySelector('#item-form');
  if(form&&files.length===1){processSinglePhoto(files[0],form).catch(error=>toast(error.message));return;}
  if(uploadSession){addUploadFiles(files);return;}
  openUploadDialog(files);
});
document.addEventListener('keydown',event=>{
  if(event.target.id==='upload-dropzone'&&['Enter',' '].includes(event.key)){event.preventDefault();document.querySelector('#batch-files')?.click();}
});

document.addEventListener('input',event=>{
  const input=event.target;
  if(input.dataset.uploadField&&uploadSession&&!uploadSession.saving){const row=uploadSession.rows.find(row=>row.id===input.dataset.row);if(row){const field=input.dataset.uploadField;if(field==='selected')row.selected=input.checked;else if(field==='color'){row.meta.color=input.value;row.meta.colorName=COLORS.find(c=>c.value===input.value)?.name;}else if(field==='targetDescription')row.targetDescription=input.value;else row.meta[field]=input.value;if(['category','targetDescription'].includes(field)&&row.result){row.result=null;row.image=row.originalImage;row.status='prepared';row.imageKind='original';row.cutoutStatus='original';row.error='';updateUploadRow(row,uploadSession);}updateUploadSummary(uploadSession);}}
  if(input.name==='targetDescription'&&input.closest('#item-form')&&(modalPendingResult||modalImageKind==='flatlay'))invalidateSingleResult(input.closest('#item-form'));
  if(input.id==='wardrobe-search'){ui.search=input.value;document.querySelector('#garment-results').innerHTML=garmentResults(filteredItems());}
  if(input.id==='draft-name')ui.draft.name=input.value;
  if(input.id==='canvas-color'){ui.draft.background=input.value;document.querySelector('#canvas-board').style.background=input.value;}
  if(['element-size','element-rotation'].includes(input.id)){
    const el=ui.draft.elements.find(e=>e.key===ui.selected);if(!el)return;
    if(input.id==='element-size')el.width=Number(input.value);else el.rotation=Number(input.value);
    const target=document.querySelector(`[data-element="${el.key}"]`);if(target){target.style.width=`${el.width/640*100}%`;target.style.transform=`translate(-50%,-50%) rotate(${el.rotation}deg)`;}
  }
});

document.addEventListener('change',async event=>{
  const input=event.target;
  const filters={'season-filter':'season','style-filter':'style','sort-filter':'sort','studio-category':'studioCategory'};
  if(filters[input.id]){ui[filters[input.id]]=input.value;render();}
  if(input.id==='item-photo'&&input.files[0]){
    const files=[...input.files];input.value='';
    if(files.length>1){openUploadDialog(files);return;}
    const form=modalRoot.querySelector('#item-form');
    await processSinglePhoto(files[0],form);
  }
  if(input.id==='batch-files'&&input.files.length){const files=[...input.files];input.value='';addUploadFiles(files);}
  if(input.name==='category' && input.closest('#item-form') && !input.closest('#item-form').dataset.id && !input.closest('#item-form').dataset.customPhoto) {
    const assets = {'上装':'cotton-shirt','下装':'straight-jeans','连衣裙':'black-dress','外套':'trench-coat','鞋履':'white-sneakers','配饰':'shoulder-bag'};
    modalImage=`./assets/garments/${assets[input.value]}.svg`;modalOriginal=modalImage;document.querySelector('#photo-preview img').src=modalImage;
  }
  if(input.name==='category'&&input.closest('#item-form')&&(modalPendingResult||modalImageKind==='flatlay'))invalidateSingleResult(input.closest('#item-form'));
  if(input.id==='backup-file'&&input.files[0]){
    try{
      const file=input.files[0];if(file.size>100*1024*1024)throw new Error('备份超过 100 MB，请使用较小的备份。');
      const backup=validateBackup(JSON.parse(await file.text()));
      confirmDialog('导入这份备份？',`包含 ${backup.items.length} 件衣物、${backup.outfits.length} 套搭配、${backup.diary.length} 次穿搭记录。导入会替换当前数据，请先确认已有备份。`,'confirm-import','确认导入');
      const button=modalRoot.querySelector('[data-action="confirm-import"]');
      button.addEventListener('click',async()=>{if(await commit(backup,'备份导入成功。')){ui.draft={name:'',background:'#f3f0e9',elements:[]};closeDialog();}});
    }catch(error){toast(error instanceof SyntaxError?'备份文件不是有效的 JSON。':error.message);}input.value='';
  }
});

document.addEventListener('submit',async event=>{
  const form=event.target;
  if(!['item-form','diary-form','suggestion-form','settings-form','flatlay-settings-form'].includes(form.id))return;
  event.preventDefault();
  const data=new FormData(form);
  try{
    if(form.id==='item-form'){
      if(form.dataset.photoBusy==='true'){toast('照片正在处理中，请稍候保存。');return;}
      if(!form.dataset.id && modalPhotoSource!=='photo'){toast('请先上传真实衣物照片。');return;}
      if(modalPendingResult&&!modalPendingResult.confirmed){toast('请先确认平铺结果，或还原为原图。');return;}
      const name=String(data.get('name')).trim();if(!name){toast('请填写衣物名称。');return;}
      const color=COLORS.find(c=>c.value===data.get('color')),id=form.dataset.id||uid(), existing=state.items.find(item=>item.id===id);
      const item={...existing,id,name,category:data.get('category'),color:color.value,colorName:color.name,seasons:data.getAll('seasons'),style:data.get('style'),brand:String(data.get('brand')).trim(),price:Number(data.get('price')),wearCount:Number(data.get('wearCount')),favorite:existing?.favorite||false,image:modalImage,source:modalPhotoSource,createdAt:existing?.createdAt||new Date().toISOString(),notes:String(data.get('notes')).trim()};
      if(modalPhotoSource==='photo'){item.originalImage=modalOriginal;item.cutoutStatus=modalCutoutStatus;item.imageKind=modalImageKind;item.imageSource=modalImageKind==='flatlay'?'generated':'local';
        if(modalPendingResult?.confirmed){item.imageProvider=modalPendingResult.provider;item.imageModel=modalPendingResult.model;item.processedAt=new Date().toISOString();}
        if(modalImageKind!=='flatlay')for(const key of ['imageProvider','imageModel','processedAt'])delete item[key];
      }
      const next=structuredClone(state),index=next.items.findIndex(item=>item.id===id);if(index>=0)next.items[index]=item;else next.items.unshift(item);
      validateBackup(next);
      if(await commit(next,'衣物已收进衣橱。')&&form.isConnected)closeDialog();
    }
    if(form.id==='diary-form'){
      const entry={id:uid(),date:data.get('date'),name:String(data.get('name')).trim(),notes:String(data.get('notes')).trim(),itemIds:data.getAll('itemIds'),outfitId:form.dataset.outfit||null};
      if(!entry.name){toast('请为穿搭起个名字。');return;}
      const next=addDiary(state,entry);validateBackup(next);
      if(await commit(next,'穿搭已记录，穿着次数也更新了。')){ui.selectedDate=entry.date;ui.month=entry.date.slice(0,7);closeDialog();if(ui.route==='calendar')render();}
    }
    if(form.id==='suggestion-form'){
      const options={season:data.get('season'),style:data.get('style'),photoMode:'processed'};
      const picked=suggestOutfit(state.items,options);
      if(!picked.length){const status=outfitSuggestionStatus(state.items,options);document.querySelector('#suggestion-status').textContent=status.message;return;}
      closeDialog();setDraft({name:`${data.get('season')}日 · ${data.get('style')==='全部风格'?'日常灵感':data.get('style')}`,background:'#f3f0e9',elements:layoutOutfit(picked)});
    }
    if(form.id==='settings-form'){
      const name=String(data.get('name')).trim();if(!name){toast('衣橱名称不能为空。');return;}
      const next=structuredClone(state);next.settings.name=name;await commit(next,'衣橱名称已更新。');
    }
    if(form.id==='flatlay-settings-form'){
      const config=setFlatlayConfig({url:data.get('url'),token:data.get('token')});
      document.querySelector('#flatlay-service-status').textContent=config.url?'连接设置已保存，请检查连接。':'已移除服务连接。';
      toast('平铺 AI 连接设置已保存。');
    }
  }catch(error){toast(error.message||'操作失败，请重试。');}
});

document.addEventListener('keydown',event=>{
  if(ui.route!=='studio'||modalRoot.childElementCount||/INPUT|TEXTAREA|SELECT/.test(event.target.tagName)||!ui.selected)return;
  const element=ui.draft.elements.find(e=>e.key===ui.selected);if(!element)return;
  if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key)){
    event.preventDefault();const delta=event.shiftKey?10:2;
    if(event.key==='ArrowUp')element.y=Math.max(0,element.y-delta);if(event.key==='ArrowDown')element.y=Math.min(700,element.y+delta);if(event.key==='ArrowLeft')element.x=Math.max(0,element.x-delta);if(event.key==='ArrowRight')element.x=Math.min(640,element.x+delta);
    const target=document.querySelector(`[data-element="${element.key}"]`);target.style.left=`${element.x/640*100}%`;target.style.top=`${element.y/700*100}%`;
  }
  if(event.key==='Delete'||event.key==='Backspace'){event.preventDefault();ui.draft.elements=ui.draft.elements.filter(e=>e.key!==ui.selected);ui.selected=null;render();}
});

window.addEventListener('hashchange',()=>{const route=location.hash.slice(1);if(routes[route]){ui.route=route;render();}});
window.addEventListener('focus', async () => {
  if (!state || storageBroken || saving || modalRoot.childElementCount) return;
  try {
    const latest = await loadState();
    if (latest && latest._revision !== state._revision) { validateBackup(latest); state = latest; render(); }
  } catch { /* A failed background refresh must not replace the current data. */ }
});

try {
  state=await loadState();
  if(!state){
    state=seedState();
    try { await saveState(state); }
    catch(error) { if(error.code==='CONFLICT')state=await loadState();else throw error; }
  }
  validateBackup(state);
  render();
} catch(error) {
  console.error('Storage unavailable',error.name);
  state=seedState();storageBroken=true;render();
  toast('无法读取浏览器存储。当前展示示例，修改暂时无法保存。');
}
