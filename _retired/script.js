/* ==========================================================
   RAPIDKERT – közös script
========================================================== */

/* ---------- Mobil menü ---------- */
(function(){
  var toggle = document.getElementById('menuToggle');
  var links  = document.getElementById('navLinks');
  if(!toggle || !links) return;

  toggle.addEventListener('click', function(){
    var open = links.classList.toggle('open');
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    toggle.textContent = open ? '\u2715' : '\u2630';
  });

  links.querySelectorAll('a').forEach(function(a){
    a.addEventListener('click', function(){
      links.classList.remove('open');
      toggle.setAttribute('aria-expanded','false');
      toggle.textContent = '\u2630';
    });
  });
})();

/* ---------- GYIK akkordeon ---------- */
(function(){
  var items = document.querySelectorAll('.faq-item');
  if(!items.length) return;

  document.querySelectorAll('.faq-q').forEach(function(q){
    q.addEventListener('click', function(){
      var item = q.parentElement;
      var open = item.classList.contains('open');

      items.forEach(function(i){
        i.classList.remove('open');
        var btn = i.querySelector('.faq-q');
        if(btn) btn.setAttribute('aria-expanded','false');
      });

      if(!open){
        item.classList.add('open');
        q.setAttribute('aria-expanded','true');
      }
    });
  });
})();

/* ---------- Ajánlatkérő űrlap (Web3Forms) ---------- */
(function(){
  var form = document.getElementById('quoteForm');
  if(!form) return;

  var status = document.getElementById('formStatus');
  var submit = document.getElementById('formSubmit');
  var submitText = submit ? submit.textContent : '';

  function show(type, msg){
    if(!status) return;
    status.className = 'form-status show ' + type;
    status.textContent = msg;
    status.scrollIntoView({behavior:'smooth', block:'center'});
  }

  form.addEventListener('submit', function(e){
    e.preventDefault();

    // Honeypot: ha ki van töltve, bot -> csendben eldobjuk
    var hp = form.querySelector('input[name="botcheck"]');
    if(hp && hp.checked) return;

    if(submit){
      submit.disabled = true;
      submit.textContent = 'Küldés folyamatban…';
    }

    var data = new FormData(form);

    fetch('https://api.web3forms.com/submit', {
      method: 'POST',
      body: data
    })
    .then(function(r){ return r.json(); })
    .then(function(res){
      if(res.success){
        show('ok', 'Köszönjük! Megkaptuk az ajánlatkérésed – 1 munkanapon belül keresünk telefonon.');
        form.reset();
      } else {
        show('err', 'Sajnos nem sikerült elküldeni. Kérjük, hívj minket: +36 30 726 0024');
      }
    })
    .catch(function(){
      show('err', 'Hálózati hiba. Kérjük, hívj minket: +36 30 726 0024');
    })
    .finally(function(){
      if(submit){
        submit.disabled = false;
        submit.textContent = submitText;
      }
    });
  });
})();

/* ---------- Galéria szűrő ---------- */
(function(){
  var filters = document.querySelectorAll('.filter');
  var shots   = document.querySelectorAll('.shot');
  if(!filters.length || !shots.length) return;

  filters.forEach(function(btn){
    btn.addEventListener('click', function(){
      var want = btn.dataset.filter;

      filters.forEach(function(b){
        var on = (b === btn);
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });

      shots.forEach(function(s){
        var show = (want === 'all' || s.dataset.cat === want);
        s.hidden = !show;
      });
    });
  });
})();

/* ---------- Lightbox ---------- */
(function(){
  var box = document.getElementById('lightbox');
  if(!box) return;

  var img   = document.getElementById('lbImg');
  var cap   = document.getElementById('lbCap');
  var close = document.getElementById('lbClose');
  var prev  = document.getElementById('lbPrev');
  var next  = document.getElementById('lbNext');
  var shots = Array.prototype.slice.call(document.querySelectorAll('.shot'));
  var i = 0;
  var lastFocus = null;

  function visible(){
    return shots.filter(function(s){ return !s.hidden; });
  }

  function show(shot){
    var list = visible();
    i = list.indexOf(shot);
    render();
    box.hidden = false;
    document.body.style.overflow = 'hidden';
    close.focus();
  }

  function render(){
    var list = visible();
    if(!list.length) return;
    if(i < 0) i = list.length - 1;
    if(i >= list.length) i = 0;

    var shot = list[i];
    var thumb = shot.querySelector('img');
    img.src = shot.dataset.full;
    img.alt = thumb ? thumb.alt : '';
    var fc = shot.querySelector('figcaption');
    cap.textContent = fc ? fc.textContent.replace(/^(Kertépítés|Öntözés)/, '').trim() : '';

    var many = list.length > 1;
    prev.hidden = !many;
    next.hidden = !many;
  }

  function hide(){
    box.hidden = true;
    img.src = '';
    document.body.style.overflow = '';
    if(lastFocus) lastFocus.focus();
  }

  shots.forEach(function(s){
    s.addEventListener('click', function(){
      lastFocus = s;
      show(s);
    });
  });

  close.addEventListener('click', hide);
  prev.addEventListener('click', function(){ i--; render(); });
  next.addEventListener('click', function(){ i++; render(); });

  box.addEventListener('click', function(e){
    if(e.target === box) hide();
  });

  document.addEventListener('keydown', function(e){
    if(box.hidden) return;
    if(e.key === 'Escape')     hide();
    if(e.key === 'ArrowLeft')  { i--; render(); }
    if(e.key === 'ArrowRight') { i++; render(); }
  });
})();
