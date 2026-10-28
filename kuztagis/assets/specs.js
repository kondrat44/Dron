/* Рендер карточек специальностей + фильтры */
const GROUPKEY={'Архитектура и дизайн':'arch','Геодезия и земля':'geo','Строительство':'build','Сварка':'weld'};
function rub(n){return (n/1000).toLocaleString('ru-RU')+' тыс ₽'}
function renderSpecs(box,list){
  box.innerHTML=list.map((s,i)=>`
  <details class="spec rv ${i%2?'d1':''}" data-type="${s.type}" data-group="${GROUPKEY[s.group]}" data-q="${(s.name+' '+s.code+' '+s.group+' '+s.d).toLowerCase()}">
    <summary>
      <div class="emoji">${s.e}</div>
      <div class="t"><div class="code">${s.code} · ${s.group}</div><h3>${s.name}</h3>
        <div class="tags"><span class="tag blue">${s.type==='spec'?'Специалист среднего звена':'Квалифицированный рабочий'}</span>
        ${s.exam?`<span class="tag">Испытание: ${s.exam}</span>`:'<span class="tag green">Без экзаменов</span>'}</div></div>
      <div class="chev"><svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></div>
    </summary>
    <div class="body">
      <p>${s.d}</p>
      <div class="facts"><div><b>${s.budget}</b><span>бюджетных мест</span></div><div><b>${rub(s.price)}</b><span>платно, в год от</span></div><div><b>Очно</b><span>форма обучения</span></div></div>
      <a class="link" href="abiturientu.html">Как поступить</a>
    </div>
  </details>`).join('');
  box.querySelectorAll('.rv').forEach(el=>{
    new IntersectionObserver((es,o)=>es.forEach(e=>{if(e.isIntersecting){e.target.classList.add('in');o.disconnect()}}),{threshold:.1}).observe(el);
  });
}
