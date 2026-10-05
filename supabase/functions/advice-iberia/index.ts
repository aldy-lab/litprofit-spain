// ============================================================
// ADVICE — the only place an API key is allowed to be
// ============================================================
// The calculator is a static page on GitHub Pages. A model key put anywhere
// in it is a published key: the page is the file, "view source" is the whole
// attack, and a key that bills to a card cannot be treated more casually than
// the service_role key it sits next to. So the key lives here as a function
// secret and the browser never sees it, exactly as the database is reached
// through RPCs rather than through a connection string.
//
// WHAT THIS FUNCTION IS FOR, AND WHAT IT IS NOT FOR
// -------------------------------------------------
// It does not analyse anything. advice_facts() in the database computes every
// figure; this passes that sheet to a model and asks it to choose which few
// facts matter and say so in a sentence. The model is told it may not
// calculate, and that instruction is enforceable rather than hopeful, because
// every number it is permitted to use is already in the sheet in front of it
// -- so a figure in the reply that is not in the sheet is detectable, and the
// check at the bottom of this file does detect it.
//
// WHAT LEAVES THE BUILDING
// ------------------------
// Aggregates, and no names. Salaries and the people attached to them are not
// in the sheet at all. Client names ARE in the sheet -- concentration advice
// is worthless without knowing which client -- so they are replaced here with
// CLIENT_1..N before the request goes out, and the map comes back to the
// browser to put the real names on screen. The model reasons about a customer
// list it never sees; the reader gets the names anyway. The company's client
// list is the company's.
//
// IT WORKS WITHOUT A KEY
// ----------------------
// With no ANTHROPIC_API_KEY configured this still answers, with the fact
// sheet and `ai: false`. The deterministic half is the half that cannot be
// wrong, and it is worth reading on its own -- a button that dies with
// "not configured" would take the measured figures down with the unmeasured
// ones for no reason.
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const MODEL = "claude-sonnet-5";

/* Anthropic issues two kinds of key. A workspace key carries its workspace
   with it; an identity-linked key belongs to a person and does not, so the
   request has to name the workspace it acts in or the API refuses it before
   the model is ever reached. Optional here, because a workspace key needs no
   such thing -- set ANTHROPIC_WORKSPACE_ID only if the key is the other kind,
   and the header appears only when it is set. */
const WORKSPACE = Deno.env.get("ANTHROPIC_WORKSPACE_ID");
/* 1600 was not enough for five findings and three blocked questions in
   Russian -- Cyrillic costs roughly twice the tokens of the same sentence in
   English -- and the reply came back truncated mid-tool-call: `findings` was
   a 300-character string instead of a list. Nothing errored. The panel would
   have rendered whatever that was. */
const MAX_TOKENS = 3000;

// One call per owner per day is the shape of this feature, so the cache is
// about repeated presses in one afternoon rather than about throughput.
const CACHE_HOURS = 24;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

/* ---------- the instructions ----------
   Written as prohibitions because that is what is being bought here. A model
   asked "how is this company doing" will happily produce a margin from a
   sheet that says the margin is unknown, and it will format it like the real
   figures. Every rule below exists because its absence produces a confident
   sentence about somebody's business that nothing on the page contradicts. */
const SYSTEM = `You are reading a fact sheet from the project calculator of
Litprofit's Iberian operation — the Spanish and Portuguese work of a Klaipeda
ship-repair company. They overhaul marine refrigeration plant, engines and
piping on fishing vessels and shore installations — so a large part of the
business is: a shipowner asks for a part or a job, they price it (often against
a supplier quote), and it either becomes an order or does not.
That register of enquiries is most of what you are looking at.

WHAT THE READER CAN ACTUALLY DO
The reader is the owner or a manager, sitting in front of this tool. Inside it
they can: chase or close an enquiry, send a quote that was never sent, fill in
a cost, mark an invoice paid, add staff and fixed costs, and run a job through
the project sheets. Advice they cannot act on from that chair is wasted.

RULES, in order of importance:

1. NEVER compute, estimate, extrapolate or round a number of your own. You may
   only quote figures that appear verbatim in the fact sheet. If a point needs
   a number that is not in the sheet, drop the point. A reply containing a
   figure that is not in the sheet is discarded in full, not corrected.

2. Any block with "enough": false does NOT support conclusions. Say it cannot
   be answered yet and what would make it answerable. Do not reason about it as
   though it were answerable.

3. BEFORE calling anything a pattern, check the sheet for the one deal that
   explains it. deal_size carries medians beside means and the largest single
   loss for exactly this reason. If win_rate_value is far below win_rate_count,
   look at lost_max_share_of_lost before concluding they lose large jobs: one
   outsized rejected enquiry moves that rate on its own, and the medians may
   say the opposite. Getting this wrong sends them chasing a problem that does
   not exist, which is worse than saying nothing.

4. THE READER'S STANDING QUESTION IS PROFIT: where the money goes and how to
   keep more of it. Lead with that whenever the sheet supports it. The blocks
   that answer it are `money` (share_of_spend says which article each euro of
   spend went to), `margin`, and `burn` (what the company costs to keep open,
   which every job has to clear before it earns anything).

   When those blocks say enough:false, do NOT pad the answer with funnel
   findings and present them as profitability advice. Say plainly that
   profitability cannot be computed yet, name the one thing that would make it
   computable, and say what not knowing is worth -- `unknown_profit` carries
   exactly that: won and delivered work whose cost was never entered, in
   euros. A number is a reason; "fill in the data" is a chore.

5. Read the trend block. A business is a direction, not a snapshot, and a fall
   in enquiries arriving is upstream of every other number here.

6. Cash is not profit and the sheet keeps them apart. delivered_unpaid is
   money earned and not collected; it belongs in the answer, but do not call
   it margin.

7. Advice must be an action for Monday, tied to the figure it came from.
   "Improve your margins" is not advice. "Nineteen quoted jobs have been
   undecided over 90 days — call them or close them" is.

8. Say the uncomfortable thing if the sheet says it. You are not here to
   reassure, and you are not here to congratulate them on a figure either.

9. At most 5 findings, ranked by what it costs them. Fewer is better. If the
   sheet supports only two real findings, give two.

10. No preamble, no restatement of what you were given, no offer to help
   further. The reader wants the finding and the action.

THE WORDS THIS TOOL USES
Write the way the screen in front of the reader writes, or the advice sounds
like it is about a different application. Use ONLY the list for the language
you are writing in, in titles as well as in bodies, and never carry a word
from one list into the other language.

lang = ru: a row in the register is "запрос" and never "заявка"; the price
sent to a client is "предложение" and never "квота"; an accepted order is
"заказ"; cost is "себестоимость"; the sale price is "продажа"; the two ticks
are "поставлено" and "оплачено".

lang = lt: "užklausa"; "pasiūlymas"; "užsakymas"; "savikaina"; "pristatyta";
"apmokėta".

lang = en: "enquiry"; "quote"; "order"; "cost"; "price"; "delivered"; "paid".

FIELD NAMES BELONG IN `evidence` AND NOWHERE ELSE. The sheet's keys --
labor_actual, delivered_unpaid_eur, money.projects_with_actuals -- are the
audit trail and they are printed under the finding as such. In a title or a
body, name the thing the way the screen names it: the sheet where labour goes
is "Персонал" / "Personalas" / "Labour", materials are "Материалы" /
"Medžiagos" / "Materials", and so on. A shipyard owner reading advice about
labor_actual is reading about somebody else's software.

You must answer by calling the tool. Write in the language given as "lang":
ru = Russian, lt = Lithuanian, en = English.`;

const TOOL = {
  name: "advice",
  description: "The findings, ranked by what they cost the company.",
  input_schema: {
    type: "object",
    properties: {
      findings: {
        type: "array",
        maxItems: 5,
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "Six words or fewer." },
            body: {
              type: "string",
              description:
                "Two or three sentences: what the figure is, why it matters, what to do.",
            },
            evidence: {
              type: "string",
              description:
                "The figures this rests on, copied from the sheet. Nothing else.",
            },
            severity: { type: "string", enum: ["watch", "act", "urgent"] },
          },
          required: ["title", "body", "evidence", "severity"],
        },
      },
      blocked: {
        type: "array",
        description:
          "Questions the data cannot answer yet, and the single thing that would unblock each.",
        items: {
          type: "object",
          properties: {
            question: { type: "string" },
            unblock: { type: "string" },
          },
          required: ["question", "unblock"],
        },
      },
    },
    required: ["findings", "blocked"],
  },
};

/* Client names out, placeholders in. Returns the sheet to send and the map to
   put the names back with -- the browser does the restoring, so the real list
   never travels. */
function anonymise(facts: Record<string, unknown>) {
  const map: Record<string, string> = {};
  const clients = Array.isArray(facts.clients) ? facts.clients : [];
  const masked = clients.map((c: Record<string, unknown>, i: number) => {
    const key = `CLIENT_${i + 1}`;
    map[key] = String(c.client ?? "");
    return { ...c, client: key };
  });
  return { sheet: { ...facts, clients: masked }, map };
}

/* Every number the model used, checked against the sheet it was given.

   This is the one guard that would catch the failure this whole design is
   arranged against: an invented figure, formatted exactly like a measured
   one. It is deliberately crude -- it pulls every number out of the reply and
   asks whether that string of digits appears anywhere in the sheet. Crude is
   right here: a false positive costs one finding, and a false negative costs
   the reader's trust in every figure on the screen. */
function unsupported(reply: unknown, sheet: unknown): string[] {
  const sheetText = JSON.stringify(sheet);
  const replyText = JSON.stringify(reply);
  const seen = new Set<string>();
  const bad: string[] = [];
  /* Thousands groups first, then plain numbers -- and a thousands group must
     be exactly three digits with no fourth behind it.

     The first version matched \d followed by any run of digits, spaces, dots
     and commas -- written without its delimiters here, because a regex
     literal ending in a star and a slash closes the comment it is inside and
     the bundler refuses the file. That version reads "105 115" correctly and
     also reads "36, 2026" as one number: strip the comma and the space and it
     becomes 362026, which is in no fact sheet anywhere. It refused a good
     answer and told the reader the model had invented a figure. The guard was
     right and its arithmetic was wrong, which is the worst way for a check to
     fail, because it accuses. */
  for (const m of replyText.matchAll(/\d{1,3}(?:[\s\u00a0,]\d{3})+(?!\d)|\d+(?:[.,]\d+)?/g)) {
    const raw = m[0].replace(/[\s\u00a0,]/g, "");
    // A bare 1-2 digit number is a count, a rank or a month; chasing those
    // rejects "at most 5 findings" and teaches nobody anything.
    if (raw.length < 3 || seen.has(raw)) continue;
    seen.add(raw);
    const plain = raw.replace(/\.0+$/, "");
    const asPct = (Number(plain) / 100).toString();
    if (
      sheetText.includes(plain) ||
      sheetText.includes(asPct) ||
      // percentages: the sheet holds 0.1708, the reply says 17 or 17.08
      sheetText.includes("0." + plain.replace(".", ""))
    ) continue;
    bad.push(plain);
  }
  return bad;
}

/* The shape, checked before anything is believed.

   A tool call cut off at the token limit still arrives as a tool call: the
   field is there and its contents are half a sentence rather than a list.
   Reading it without looking put a string where the panel expected findings,
   and the failure surfaced as garbage on screen rather than as an error --
   which is the class of bug this whole file is arranged against. */
function wellFormed(a: unknown): boolean {
  if (!a || typeof a !== "object") return false;
  const o = a as Record<string, unknown>;
  if (!Array.isArray(o.findings)) return false;
  if (o.blocked !== undefined && !Array.isArray(o.blocked)) return false;
  return (o.findings as unknown[]).every((f) => {
    if (!f || typeof f !== "object") return false;
    const g = f as Record<string, unknown>;
    return typeof g.title === "string" && typeof g.body === "string" &&
           typeof g.evidence === "string" && typeof g.severity === "string";
  });
}

/* One request builder for the first attempt and the retry. Two copies would
   be two prompts, and the second would stop matching the first the day
   somebody edits one of them. */
function callModel(key: string, payload: unknown) {
  return fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
      ...(WORKSPACE ? { "anthropic-workspace-id": WORKSPACE } : {}),
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM,
      tools: [TOOL],
      tool_choice: { type: "tool", name: "advice" },
      messages: [{ role: "user", content: JSON.stringify(payload) }],
    }),
  });
}

async function ask(key: string, payload: unknown) {
  const r = await callModel(key, payload);
  if (!r.ok) return null;
  try { return await r.json(); } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json({ error: "not signed in" }, 401);

  let lang = "en";
  let fresh = false;
  try {
    const body = await req.json();
    if (typeof body?.lang === "string") lang = body.lang;
    // "Check again" means check again. Without this the button re-served the
    // same cached answer for a day and looked broken.
    fresh = body?.fresh === true;
  } catch { /* no body is fine */ }

  // The caller's own token, so advice_facts() runs as them and its
  // sees_money() gate is the same gate as everywhere else. The function has
  // no elevated client on purpose: there is no path here that reads the
  // database as anyone other than the person who pressed the button.
  const supa = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    // The Iberia copy: every table and function lives in the `iberia`
    // schema of the same project, so the client is pointed there. Without
    // this the rpc lands on the Lithuanian figures in `public`.
    { global: { headers: { Authorization: auth } }, db: { schema: "iberia" } },
  );

  const { data: facts, error } = await supa.rpc("advice_facts");
  if (error) {
    const denied = /insufficient_privilege|not allowed/i.test(error.message);
    return json({ error: denied ? "not allowed" : error.message }, denied ? 403 : 500);
  }

  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json({ ai: false, reason: "no_key", facts });

  const { sheet, map } = anonymise(facts as Record<string, unknown>);

  // Cache on the sheet itself: the same figures give the same advice, and the
  // figures change when somebody edits the register. Nothing to expire by
  // hand, and pressing the button twice in an afternoon costs nothing.
  const hash = [...new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(JSON.stringify(sheet) + lang + MODEL),
    ),
  )].map((b) => b.toString(16).padStart(2, "0")).join("");

  // Through functions, not through the table. advice_cache carries no grants
  // to anon or authenticated -- the same deny-all every other table in this
  // schema has -- so a direct .from() would read nothing and say nothing about
  // why. The age check lives in advice_cache_get, where the clock is the
  // database's rather than this machine's.
  if (!fresh) {
    const { data: hit } = await supa.rpc("advice_cache_get", { p_id: hash });
    if (hit) return json({ ai: true, cached: true, facts, clients: map, advice: hit });
  }

  const res = await callModel(key, { lang, facts: sheet });

  if (!res.ok) {
    const detail = await res.text();
    return json({ ai: false, reason: "model_error", detail: detail.slice(0, 300), facts }, 200);
  }

  const out = await res.json();
  const block = (out.content ?? []).find((c: Record<string, unknown>) => c.type === "tool_use");
  if (!block) return json({ ai: false, reason: "no_answer", facts });

  let advice = block.input;
  /* Two ways a reply can be unusable, and one retry that covers both: figures
     that are not in the sheet, and a shape that is not an answer. */
  let invented = wellFormed(advice) ? unsupported(advice, sheet) : ["shape"];

  /* Asked again once, told exactly which figures were rejected.

     Refusing outright is the right answer to a model that will not follow the
     rule and the wrong answer to one that slipped, and the first reply gives
     no way to tell them apart. One retry costs two cents and does. Still
     refused if the second reply is no better: publishing the parts that
     happen to check out is how a reader learns to distrust the rest. */
  if (invented.length) {
    const again = await ask(key, {
      lang,
      facts: sheet,
      rejected: invented,
      note: invented[0] === "shape"
        ? "Your previous answer was cut off before it was complete. Answer " +
          "again, shorter: fewer findings, shorter bodies."
        : "Your previous answer was rejected: these figures do not appear in " +
          "the fact sheet. Quote only figures that are in it, verbatim.",
    });
    const block2 = (again?.content ?? []).find(
      (c: Record<string, unknown>) => c.type === "tool_use",
    );
    if (block2) {
      const retry = block2.input;
      const bad2 = wellFormed(retry) ? unsupported(retry, sheet) : ["shape"];
      if (!bad2.length) { advice = retry; invented = []; }
      else invented = bad2;
    }
  }
  if (invented.length) {
    // A truncated reply is not a model inventing figures, and telling the
    // reader it was would be a second wrong accusation.
    if (invented[0] === "shape") {
      return json({ ai: false, reason: "no_answer", facts }, 200);
    }
    return json({ ai: false, reason: "invented_figures", invented, facts }, 200);
  }

  await supa.rpc("advice_cache_put", {
    p_id: hash, p_advice: advice, p_lang: lang, p_model: MODEL,
  });

  return json({ ai: true, cached: false, facts, clients: map, advice });
});
