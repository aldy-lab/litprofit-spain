// ============================================================
// ADVICE (IBERIA) -- the only place an API key is allowed to be
// ============================================================
// The Lithuanian `advice` function, pointed at the `iberia` schema, with the
// company description changed and the BITZER/DANFOSS partner line left out.
// Kept in the compact form the live Lithuanian function runs, so what is in
// this file is byte for byte what is deployed. The reasoning behind each part
// (anonymised clients, the invented-figure guard, the retry) is written up in
// the litprofit repo's supabase/functions/advice/index.ts.
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const MODEL = "claude-sonnet-5";

const WORKSPACE = Deno.env.get("ANTHROPIC_WORKSPACE_ID");
const MAX_TOKENS = 3000;
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
   that answer it are \`money\` (share_of_spend says which article each euro of
   spend went to), \`margin\`, and \`burn\` (what the company costs to keep open,
   which every job has to clear before it earns anything).

   When those blocks say enough:false, do NOT pad the answer with funnel
   findings and present them as profitability advice. Say plainly that
   profitability cannot be computed yet, name the one thing that would make it
   computable, and say what not knowing is worth -- \`unknown_profit\` carries
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
   sheet supports only two real findings, give two. Keep each body to two or
   three sentences: a long answer is not a better one and can be cut off.

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

FIELD NAMES BELONG IN \`evidence\` AND NOWHERE ELSE. The sheet's keys --
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

function unsupported(reply: unknown, sheet: unknown): string[] {
  const sheetText = JSON.stringify(sheet);
  const replyText = JSON.stringify(reply);
  const seen = new Set<string>();
  const bad: string[] = [];
  for (const m of replyText.matchAll(/\d{1,3}(?:[\s\u00a0,]\d{3})+(?!\d)|\d+(?:[.,]\d+)?/g)) {
    const raw = m[0].replace(/[\s\u00a0,]/g, "");
    if (raw.length < 3 || seen.has(raw)) continue;
    seen.add(raw);
    const plain = raw.replace(/\.0+$/, "");
    const asPct = (Number(plain) / 100).toString();
    if (
      sheetText.includes(plain) ||
      sheetText.includes(asPct) ||
      sheetText.includes("0." + plain.replace(".", ""))
    ) continue;
    bad.push(plain);
  }
  return bad;
}

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
    fresh = body?.fresh === true;
  } catch { /* no body is fine */ }

  const supa = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
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

  const hash = [...new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(JSON.stringify(sheet) + lang + MODEL),
    ),
  )].map((b) => b.toString(16).padStart(2, "0")).join("");

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
  let invented = wellFormed(advice) ? unsupported(advice, sheet) : ["shape"];

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
