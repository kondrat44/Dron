/* КузТАГиС — общий скрипт: меню, анимации, специальности, калькулятор */
(function(){
const PAGES=[
  {id:'home',href:'index.html',t:'Главная'},
  {id:'spec',href:'specialnosti.html',t:'Специальности'},
  {id:'abit',href:'abiturientu.html',t:'Поступление'},
  {id:'stud',href:'studentam.html',t:'Студентам'},
  {id:'svd',href:'svedeniya.html',t:'Сведения'},
  {id:'cont',href:'kontakty.html',t:'Контакты'}
];
const cur=document.body.dataset.page||'home';
const ICON={
  home:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
  spec:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></svg>',
  abit:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 9 12 4l10 5-10 5z"/><path d="M6 11v5c0 1.5 3 3 6 3s6-1.5 6-3v-5"/></svg>',
  stud:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="3"/><path d="M3 9h18M8 2v4M16 2v4"/></svg>',
  cont:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
  menu:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 8h16M4 16h16"/></svg>',
  close:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  moon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
  sun:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>'
};

/* ---------- theme ---------- */
const root=document.documentElement;
try{const s=localStorage.getItem('kt-theme');if(s)root.dataset.theme=s}catch(e){}
function isDark(){return root.dataset.theme?root.dataset.theme==='dark':matchMedia('(prefers-color-scheme: dark)').matches}

/* ---------- chrome ---------- */
const nav=document.createElement('header');
nav.className='nav';
nav.innerHTML=`<div class="wrap">
  <a class="brand" href="index.html" aria-label="КузТАГиС — на главную"><img src="assets/logo.svg" alt=""><span>КузТАГиС<small>техникум архитектуры, геодезии и строительства</small></span></a>
  <nav class="nav-links">${PAGES.map(p=>`<a href="${p.href}" class="${p.id===cur?'active':''}">${p.t}</a>`).join('')}</nav>
  <div class="nav-actions">
    <button class="icon-btn" id="themeBtn" aria-label="Сменить тему">${isDark()?ICON.sun:ICON.moon}</button>
    <a class="btn sm" href="abiturientu.html">Поступить</a>
    <button class="icon-btn burger" id="burger" aria-label="Меню">${ICON.menu}</button>
  </div></div>`;
document.body.prepend(nav);
const prog=document.createElement('div');prog.className='progress';document.body.prepend(prog);

const sheet=document.createElement('div');
sheet.className='sheet';
sheet.innerHTML=`<button class="icon-btn close" aria-label="Закрыть">${ICON.close}</button>`+
  PAGES.map((p,i)=>`<a href="${p.href}" style="transition-delay:${.05*i+.05}s">${p.t}</a>`).join('')+
  `<p class="muted" style="margin-top:28px">Приёмная: <a href="tel:+73842381783" style="display:inline;font-size:inherit;border:0;padding:0;opacity:1;transform:none" class="accent">+7 (3842) 38-17-83</a></p>`;
document.body.append(sheet);
const toggleSheet=o=>{sheet.classList.toggle('open',o);document.body.style.overflow=o?'hidden':''};
nav.querySelector('#burger').onclick=()=>toggleSheet(true);
sheet.querySelector('.close').onclick=()=>toggleSheet(false);

nav.querySelector('#themeBtn').onclick=e=>{
  const next=isDark()?'light':'dark';root.dataset.theme=next;
  try{localStorage.setItem('kt-theme',next)}catch(err){}
  e.currentTarget.innerHTML=next==='dark'?ICON.sun:ICON.moon;
};

const tab=document.createElement('nav');tab.className='tabbar';
tab.innerHTML=[['home','index.html','Главная'],['spec','specialnosti.html','Обучение'],['abit','abiturientu.html','Поступить'],['stud','studentam.html','Студентам'],['cont','kontakty.html','Контакты']]
 .map(([id,h,t])=>`<a href="${h}" class="${id===cur?'active':''}">${ICON[id]}<span>${t}</span></a>`).join('');
document.body.append(tab);

const foot=document.createElement('footer');
foot.innerHTML=`<div class="wrap"><div class="foot">
  <div><div class="brand"><img src="assets/logo.svg" alt=""><span>КузТАГиС</span></div>
  <p>Государственное автономное профессиональное образовательное учреждение «Кузбасский техникум архитектуры, геодезии и строительства»</p>
  <p style="margin-top:10px">650024, г. Кемерово, ул. Радищева, 5</p></div>
  <div><h4>Обучение</h4><a href="specialnosti.html">Специальности</a><a href="abiturientu.html">Абитуриенту</a><a href="studentam.html">Студентам</a></div>
  <div><h4>Техникум</h4><a href="svedeniya.html">Сведения об ОО</a><a href="index.html#about">О техникуме</a><a href="kontakty.html">Контакты</a></div>
  <div><h4>Связь</h4><a href="tel:+73842381783">+7 (3842) 38-17-83</a><a href="tel:+73842381735">+7 (3842) 38-17-35</a><a href="mailto:kuztagis@mail.ru">kuztagis@mail.ru</a></div>
</div><div class="legal"><span>© ${new Date().getFullYear()} КузТАГиС. Неофициальная концепция редизайна сайта.</span><a href="https://kuztagis.kemobl.ru/" target="_blank" rel="noopener">Официальный сайт ›</a></div></div>`;
document.body.append(foot);

/* hide nav on scroll down, progress bar */
let lastY=0;
addEventListener('scroll',()=>{
  const y=scrollY,h=document.documentElement.scrollHeight-innerHeight;
  prog.style.width=(h>0?y/h*100:0)+'%';
  nav.style.transform=(y>lastY&&y>200&&!sheet.classList.contains('open'))?'translateY(-100%)':'';
  lastY=y;
},{passive:true});

/* ---------- word-by-word headline ---------- */
document.querySelectorAll('.words').forEach(el=>{
  const parts=el.innerHTML.split(/(<[^>]+>[^<]*<\/[^>]+>|\s+)/).filter(s=>s&&s.trim());
  el.innerHTML=parts.map((w,i)=>`<span style="animation-delay:${.15+i*.08}s">${w}</span>`).join(' ');
});

/* ---------- reveal + counters ---------- */
const io=new IntersectionObserver(es=>es.forEach(e=>{
  if(!e.isIntersecting)return;
  e.target.classList.add('in');
  e.target.querySelectorAll('[data-count]').forEach(countUp);
  if(e.target.dataset.count)countUp(e.target);
  io.unobserve(e.target);
}),{threshold:.15,rootMargin:'0px 0px -40px 0px'});
document.querySelectorAll('.rv,.zoom,[data-count]').forEach(el=>io.observe(el));
function countUp(el){
  if(el.dataset.done)return;el.dataset.done=1;
  const end=+el.dataset.count,dur=1600,t0=performance.now(),suf=el.dataset.suffix||'';
  (function f(t){const p=Math.min((t-t0)/dur,1),v=Math.round(end*(1-Math.pow(1-p,4)));
    el.textContent=v.toLocaleString('ru-RU')+suf;if(p<1)requestAnimationFrame(f)})(t0);
}

/* parallax blobs */
const blobs=document.querySelectorAll('.blob');
if(blobs.length&&matchMedia('(pointer:fine)').matches){
  addEventListener('mousemove',e=>{const x=e.clientX/innerWidth-.5,y=e.clientY/innerHeight-.5;
    blobs.forEach((b,i)=>b.style.translate=`${x*40*(i+1)}px ${y*40*(i+1)}px`)},{passive:true});
}

/* ---------- segmented controls ---------- */
window.initSeg=function(seg,onChange){
  const pill=document.createElement('span');pill.className='pill';seg.prepend(pill);
  const btns=[...seg.querySelectorAll('button')];
  const move=b=>{pill.style.left=b.offsetLeft+'px';pill.style.width=b.offsetWidth+'px'};
  btns.forEach(b=>b.onclick=()=>{btns.forEach(x=>x.classList.remove('on'));b.classList.add('on');move(b);onChange(b.dataset.v)});
  requestAnimationFrame(()=>move(seg.querySelector('.on')||btns[0]));
  addEventListener('resize',()=>move(seg.querySelector('.on')||btns[0]));
};
})();
