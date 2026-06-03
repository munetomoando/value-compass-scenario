/*
 * app.js — 画面遷移・設問進行・応答時間計測・送信（設計書 §10, §8.2）
 * 推定はクライアント側（estimate.js）で完結。バックエンドが落ちていても結果表示は成立する。
 */
(function () {
  "use strict";

  // ===== 設定 =====
  // Worker のエンドポイント。空文字なら送信せずローカル完結（フロント完結版）。
  const SUBMIT_ENDPOINT = "https://value-compass-scenario.ando-munetomo.workers.dev/api/submit";

  // ===== 状態 =====
  let DATA = null;        // questions.json
  let META = null;
  let SEQUENCE = [];      // 提示する設問の配列（練習→本番→…）
  let cursor = 0;
  let answers = [];       // { q_id, choice, response_ms }
  let questionShownAt = 0;
  let sessionId = "";
  let estResult = null;

  const SCN = {
    A: { key:"single_no_plan",   title:"独身・結婚の予定なし", desc:"30歳のあなた。独身で、当面結婚の予定はありません。自分の暮らしを基準に、これから就く仕事を選んでください。正解はありません。率直に。" },
    B: { key:"married_one_child", title:"既婚・子ども1人（育児中）", desc:"30歳のあなた。結婚していて、小さな子どもが1人います。家庭との両立も考えながら、これから就く仕事を選んでください。正解はありません。率直に。" }
  };

  // ===== ユーティリティ =====
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function $(sel) { return document.querySelector(sel); }
  function show(id) {
    document.querySelectorAll(".screen").forEach(function (s) { s.classList.remove("active"); });
    $("#" + id).classList.add("active");
    window.scrollTo(0, 0);
  }

  function attrLine(attrId, level) {
    const def = META.attributes[attrId];
    return { label: def.label, value: def.levels[level] };
  }

  // ===== 初期化 =====
  function init() {
    fetch("questions.json")
      .then(function (r) { return r.json(); })
      .then(function (json) {
        DATA = json;
        META = json.meta;
        SEQUENCE = window.ValueCompassSequence.buildSequence(json.questions);
        bindIntro();
      })
      .catch(function (e) {
        $("#intro").innerHTML = '<p class="error">設問データの読み込みに失敗しました。ローカルでは簡易サーバ経由で開いてください（例: <code>python3 -m http.server</code>）。</p>';
        console.error(e);
      });
  }

  function bindIntro() {
    $("#start-btn").addEventListener("click", function () {
      sessionId = uuid();
      cursor = 0;
      answers = [];
      renderQuestion();
      show("question");
    });
  }

  function bindTransition() {
    $("#begin-main-btn").addEventListener("click", function () {
      const firstScn = SEQUENCE.find(function(q){ return q.type==="main"; }).scenario;
      showScenarioIntro(firstScn);
    });
    $("#scn-begin-btn").addEventListener("click", function () { renderQuestion(); show("question"); });
    $("#switch-begin-btn").addEventListener("click", function () { renderQuestion(); show("question"); });
  }
  function showScenarioIntro(scn){
    $("#scn-kicker").textContent = "1つ目の人生";
    $("#scn-title").textContent = SCN[scn].title;
    $("#scn-desc").textContent = SCN[scn].desc;
    show("scenario-intro");
  }
  function showScenarioSwitch(scn){
    $("#switch-title").textContent = SCN[scn].title;
    $("#switch-desc").textContent = SCN[scn].desc;
    show("scenario-switch");
  }

  // ===== 設問描画 =====
  function renderQuestion() {
    const q = SEQUENCE[cursor];
    const order = META.attribute_order;

    // 進捗（練習・支配は番号表示を工夫）
    const totalForBar = SEQUENCE.length;
    $("#progress-bar-fill").style.width = ((cursor) / totalForBar * 100) + "%";

    let badge = "";
    if (q.type === "practice") badge = '<span class="badge practice">練習（集計対象外）</span>';
    else if (q.type === "dominant") badge = ""; // 注意チェックは本番に紛れ込ませる（ラベルを出さない）
    else {
      // 本番の通し番号
      const mainNo = SEQUENCE.slice(0, cursor + 1).filter(function (x) { return x.type === "main"; }).length;
      const mainTotal = SEQUENCE.filter(function (x) { return x.type === "main"; }).length;
      badge = '<span class="badge">設問 ' + mainNo + " / " + mainTotal + "</span>";
    }
    $("#q-badge").innerHTML = badge;
    $("#q-title").textContent = q.type === "practice"
      ? "まずは練習です。どちらの求人で働きたいですか？"
      : "どちらの求人で働きたいですか？";

    function card(side) {
      const job = q[side];
      const rows = order.map(function (attrId) {
        const a = attrLine(attrId, job[attrId]);
        return '<li><span class="k">' + a.label + '</span><span class="v">' + a.value + "</span></li>";
      }).join("");
      return '<button class="job-card" data-choice="' + side + '">' +
        '<h3>求人 ' + side + "</h3><ul>" + rows + "</ul>" +
        '<span class="choose">これで働く</span></button>';
    }

    $("#choices").innerHTML = card("A") + card("B");
    $("#choices").querySelectorAll(".job-card").forEach(function (btn) {
      btn.addEventListener("click", function () { onChoose(btn.getAttribute("data-choice"), btn); });
    });

    // ページめくりアニメーションを毎回再生（同じ構図でも「進んだ」と分かるように）
    const content = $("#q-content");
    content.classList.remove("page-turn", "page-out");
    void content.offsetWidth; // reflow して再トリガ
    content.classList.add("page-turn");

    questionShownAt = performance.now();
  }

  function onChoose(choice, btn) {
    const q = SEQUENCE[cursor];
    const ms = Math.round(performance.now() - questionShownAt);
    answers.push({ q_id: q.id, choice: choice, response_ms: ms, scenario: q.scenario || null });

    if (q.type === "main") showTradeoffFlash(q, choice);

    // 選択を即座に視覚フィードバック：選んだカードを強調し、両カードを操作不可に
    const cards = $("#choices").querySelectorAll(".job-card");
    cards.forEach(function (c) {
      c.style.pointerEvents = "none";
      if (c !== btn) c.classList.add("dimmed");
    });
    if (btn) btn.classList.add("chosen");

    cursor += 1;
    const advance = function () {
      if (cursor >= SEQUENCE.length) { computeAndShowResult(); return; }
      if (q.type === "practice") { show("transition"); return; }
      const prev = SEQUENCE[cursor-1], next = SEQUENCE[cursor];
      if (prev && next && prev.type==="main" && next.type==="main" && prev.scenario!==next.scenario) {
        showScenarioSwitch(next.scenario); return;
      }
      renderQuestion();
    };

    // 反応を見せてから、ページをめくって次へ
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { advance(); return; }

    setTimeout(function () {
      const content = $("#q-content");
      content.classList.remove("page-turn");
      content.classList.add("page-out"); // めくれて消える
      setTimeout(advance, 240);
    }, 160);
  }

  function showTradeoffFlash(q, choice){
    const order = META.attribute_order;
    const chosen = q[choice], other = (choice==="A"?q.B:q.A);
    let gained=null, gave=null;
    for(const a of order){
      if(chosen[a]===other[a]) continue;
      const def=META.attributes[a];
      const better = a==="income" ? (+chosen[a]>=+other[a]) : (chosen[a]===(def.good||def.good_nominal));
      if(better && !gained) gained={attr:a};
      if(!better && !gave) gave={attr:a};
    }
    const el = document.getElementById("tradeoff-flash");
    if(!el || (!gained && !gave)) return;
    const name=a=>({income:"年収",location:"転勤の少なさ",hours:"残業の少なさ",remote:"在宅勤務",growth:"裁量・成長",stability:"雇用の安定"})[a];
    el.textContent = (gained?`いま、あなたは〔${name(gained.attr)}〕を`:"いま、あなたは")+(gave?`〔${name(gave.attr)}〕と引き換えに選びました`:"選びました");
    el.classList.remove("show"); void el.offsetWidth; el.classList.add("show");
  }

  // ===== 推定・結果 =====
  function computeAndShowResult() {
    $("#progress-bar-fill").style.width = "100%";
    const E = window.ValueCompassEstimate;
    const est2 = E.estimate2(DATA.questions, META, answers);
    const ex = E.extras(DATA.questions, META, answers, { beta: est2.beta_A, importance: est2.importance_A, importance_rank: est2.importance_rank_A, mrs_manyen: est2.mrs_A_manyen });
    estResult = { est2: est2, extras: ex };
    buildReveal(est2, ex);
    if (!ex.quality.dominant_passed) $("#quality-note").style.display = "block";
    show("result");
  }

  function mdBold(s){ return s.replace(/\*\*(.+?)\*\*/g,"<strong>$1</strong>"); }

  function buildReveal(est2, ex){
    const order = META.attribute_order;
    const label = ex.verbal.label;
    const radarLabels = { income:"年収", location:"勤務地", hours:"労働時間", remote:"在宅勤務", growth:"裁量・成長", stability:"安定性" };
    const itemsA = order.map(a=>({ label: radarLabels[a], value: est2.importance_A[a] }));
    const itemsB = order.map(a=>({ label: radarLabels[a], value: est2.importance_B[a] }));
    const radarSVG = window.ValueCompassRadar.buildRadarSVG(itemsA);
    const overlaySVG = window.ValueCompassRadar.buildRadarOverlaySVG(itemsA, itemsB);

    const moneyRows = est2.importance_rank_A.filter(a=>a!=="income").slice(0,4).map(a=>{
      const v = est2.mrs_A_manyen[a];
      const valHtml = (v===null) ? `<span class="val neg">換算を省略</span>`
        : (v>=0 ? `<span class="val">+${v}万円</span>` : `<span class="val neg">${v}万円</span>`);
      return `<div class="money-item"><span class="label">${label[a]}</span>${valHtml}</div>`;
    }).join("");
    const incNote = (Object.values(est2.mrs_A_manyen).every(v=>v===null))
      ? `<p class="money-sub">年収をあまり重視しなかったため、金額換算は省略しました。</p>`
      : `<p class="money-sub">＝その条件のために、これだけの年収を諦めてもよいと考えた、という目安です。</p>`;

    const dHi = ex.decisive.most_hesitated_qid, dLo = ex.decisive.fastest_qid;
    const qById = {}; DATA.questions.forEach(q=>qById[q.id]=q);
    const qDesc = q=>{ if(!q) return "";
      const f=j=>[
        `年収${j.income}`,
        j.location==="なし"?"転勤なし":"転勤あり",
        j.hours==="少"?"残業少":"残業多",
        j.remote==="可"?"在宅可":"出社",
        j.growth==="大"?"裁量大":"裁量小",
        j.stability==="安定"?"安定":"不安定"
      ].join("・");
      return `「${f(q.A)}」 vs 「${f(q.B)}」`;
    };

    const cards = [
      { kicker:"DISCOVERY 1 / 6", title:"あなたの重視度コンパス",
        html:`<p class="lead">${answers.filter(ans=>{const q=qById[ans.q_id];return q&&q.scored;}).length}回の選択から、各条件の重みを推定しました。外側ほど重視しています。</p><div class="radar-wrap">${radarSVG}</div>` },
      { kicker:"DISCOVERY 2 / 6", title:"お金に換算すると",
        html:`<p class="lead">あなたの選択を年収（30歳頃・額面）に換算しました。</p><div class="money">${moneyRows}</div>${incNote}` },
      { kicker:"DISCOVERY 3 / 6", title:"決定的だった瞬間",
        html:`<div class="moment"><div class="m-tag">いちばん悩んだ選択</div><div class="m-body">${qDesc(qById[dHi])}</div></div><div class="moment fast"><div class="m-tag">迷わず選んだ選択</div><div class="m-body">${qDesc(qById[dLo])}</div></div>` },
      { kicker:"DISCOVERY 4 / 6", title:"譲れない線、出せる線",
        html:`<div class="cols"><div class="box keep"><h4>譲りにくい条件</h4><ul>${ex.verbal.keep.map(s=>`<li>${s}</li>`).join("")}</ul></div><div class="box trade"><h4>交換に出しやすい条件</h4><ul>${ex.verbal.tradeable.map(s=>`<li>${s}</li>`).join("")}</ul></div></div><p class="money-sub" style="margin-top:14px">${mdBold(ex.verbal.text)}</p>` },
      { kicker:"DISCOVERY 5 / 6", title:"いま行ったことの種明かし",
        html:`<div class="reveal-box">いま行ったのは<strong>離散選択実験（DCE）</strong>です。複数条件を同時に動かす二択を繰り返すことで、口で言う重視度ではなく<strong>実際の選択から</strong>重みを逆算しています。</div>` },
      { kicker:"DISCOVERY 6 / 6", title:"2つの人生で変わるあなた",
        html:(function(){
          const lab = ex.verbal.label;
          const nonInc = order.filter(a=>a!=="income");
          // 金額（MRS）ベースの変化。年収換算が両シナリオで出せる属性のみ。
          const mrsMovers = nonInc.filter(a=>est2.delta_wtp_manyen[a]!==null)
            .sort((x,z)=>Math.abs(est2.delta_wtp_manyen[z])-Math.abs(est2.delta_wtp_manyen[x]));
          // 重要度ベースの変化（年収を重視せず金額が出せない時の代替）。
          const impDelta = a => est2.importance_B[a]-est2.importance_A[a];
          const impMovers = nonInc.slice().sort((x,z)=>Math.abs(impDelta(z))-Math.abs(impDelta(x)));
          let moverText, core;
          if (mrsMovers.length && Math.abs(est2.delta_wtp_manyen[mrsMovers[0]])>=5){
            const top = mrsMovers[0], d = est2.delta_wtp_manyen[top];
            moverText = `子育て中のあなたは、<strong>${lab[top]}</strong>の価値が ${d>=0?"+":""}${d}万円ぶん ${d>=0?"上がりました":"下がりました"}。`;
            core = mrsMovers.slice().sort((x,z)=>Math.abs(est2.delta_wtp_manyen[x])-Math.abs(est2.delta_wtp_manyen[z])).slice(0,2);
          } else if (Math.abs(impDelta(impMovers[0]))>=0.1){
            const top = impMovers[0], up = impDelta(top)>=0;
            moverText = `子育て中のあなたは、<strong>${lab[top]}</strong>の重みが ${up?"大きく上がりました":"下がりました"}。`
              + `（このシナリオでは年収をあまり重視しなかったため、金額換算は省略します）`;
            core = impMovers.slice().sort((x,z)=>Math.abs(impDelta(x))-Math.abs(impDelta(z))).slice(0,2);
          } else {
            moverText = `2つの人生で、価値の重みづけに大きな差は出ませんでした。あなたの選好は人生の状況に左右されにくいようです。`;
            core = impMovers.slice(0,2);
          }
          const coreText = core.length ? core.map(a=>lab[a]).join("・") : "—";
          return `<p class="lead">独身のあなた（青）と、子育て中のあなた（赤）の重視度を重ねました。</p>`
            + `<div class="radar-wrap">${overlaySVG}</div>`
            + `<p class="money-sub">${moverText}</p>`
            + `<div class="box keep" style="margin-top:12px"><h4>どんな人生でも譲れない核</h4><p>${coreText}</p></div>`;
        })() }
    ];

    let i=0;
    const cardEl=$("#reveal-card"), dotsEl=$("#reveal-dots"), nextEl=$("#reveal-next");
    dotsEl.innerHTML=cards.map(()=>'<span class="dot"></span>').join("");
    function renderCard(){
      const c=cards[i];
      cardEl.innerHTML=`<div class="kicker">${c.kicker}</div><h2>${c.title}</h2>${c.html}`;
      cardEl.classList.remove("turn"); void cardEl.offsetWidth; cardEl.classList.add("turn");
      Array.prototype.forEach.call(dotsEl.children,(d,k)=>d.classList.toggle("on",k===i));
      const poly=cardEl.querySelector("#dpoly"); if(poly) setTimeout(()=>poly.classList.add("show"),300);
      nextEl.textContent = i<cards.length-1 ? "次の発見へ →" : "結果に納得できるか答える →";
    }
    nextEl.onclick=function(){ if(i<cards.length-1){ i++; renderCard(); } else { show("confirm"); } };
    renderCard();
  }

  // ===== 確認画面・送信 =====
  function bindConfirm() {
    $("#confirm-form").addEventListener("submit", function (e) {
      e.preventDefault();
      const agreementEl = document.querySelector('input[name="agreement"]:checked');
      const agreement = agreementEl ? parseInt(agreementEl.value, 10) : null;
      const freeText = $("#free-text").value.trim();

      const payload = buildPayload(agreement, freeText);
      submit(payload);
    });
  }

  function buildPayload(agreement, freeText) {
    const est2 = estResult.est2, ex = estResult.extras;
    const blocks = { A:{ scenario:"single_no_plan", answers:[] }, B:{ scenario:"married_one_child", answers:[] } };
    answers.forEach(function(a){ if (a.scenario === "A") blocks.A.answers.push(a); else if (a.scenario === "B") blocks.B.answers.push(a); });
    const firstScn = SEQUENCE.find(function(q){ return q.type==="main"; }).scenario;
    return {
      session_id: sessionId,
      timestamp: new Date().toISOString(),
      framing: META.framing,
      scenario_order: firstScn==="A" ? ["single_no_plan","married_one_child"] : ["married_one_child","single_no_plan"],
      question_order: SEQUENCE.map(function(q){ return q.id; }),
      blocks: blocks,
      answers: answers,
      estimate: {
        method: "pooled_binary_logit_ridge_interaction",
        beta_A: est2.beta_A, gamma: est2.gamma,
        mrs_A_manyen: est2.mrs_A_manyen, mrs_B_manyen: est2.mrs_B_manyen,
        delta_wtp_manyen: est2.delta_wtp_manyen,
        importance_rank_A: est2.importance_rank_A, importance_rank_B: est2.importance_rank_B,
        scale_diff: est2.scale_diff, fallback_constrained: est2.fallback_constrained, converged: est2.converged
      },
      counts: ex.counts,
      decisive: ex.decisive,
      quality: Object.assign({}, ex.quality, { scale_diff: est2.scale_diff, fallback_constrained: est2.fallback_constrained }),
      feedback: { agreement: agreement, free_text: freeText },
      app_version: "0.3"
    };
  }

  function submit(payload) {
    show("complete");
    if (!SUBMIT_ENDPOINT) {
      // フロント完結版：送信先未設定。ローカルにのみ保持し、ログを表示できるようにする。
      $("#complete-note").textContent = "（ローカル完結モード：回答はサーバへ送信していません）";
      window.__lastPayload = payload;
      console.log("ValueCompass payload:", payload);
      return;
    }
    fetch(SUBMIT_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }).then(function (r) {
      $("#complete-note").textContent = r.ok ? "回答を受け付けました。" : "送信に失敗しましたが、結果は表示されています。";
    }).catch(function () {
      $("#complete-note").textContent = "送信に失敗しましたが、結果は表示されています。";
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    init();
    bindTransition();
    bindConfirm();
  });
})();
