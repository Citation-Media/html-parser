import { expect, test } from "vitest";

import { parseHtml } from "../src/index.ts";

const url = "https://firma.de/kontakt/";

test("reads forms with their fields, labels, and buttons", async () => {
  const html = `<body>
    <form id="contact" action="/senden" method="POST">
      <label for="name">Ihr Name</label><input id="name" name="name" type="text" required autocomplete="name">
      <label>E-Mail <input type="Email" name="email" placeholder=" mail@beispiel.de "></label>
      <input id="later" name="phone" type="tel">
      <select name="topic"><option>Allgemein</option></select>
      <textarea name="message" aria-label="Nachricht"></textarea>
      <input type="hidden" name="_token" value="abc">
      <input type="checkbox" id="privacy" name="privacy"><label for="later">Telefon</label>
      <input type="submit" value="Absenden"><button type="button">Zurücksetzen</button>
    </form>
    <form class="search"><input type="search" name="s"><button><svg><title>Lupe</title></svg>Suchen</button></form>
    <input type="text" name="outside">
  </body>`;
  const { forms } = await parseHtml(html, { forms: true, url });
  expect(forms).toEqual([
    {
      action: "https://firma.de/senden",
      buttons: ["Absenden", "Zurücksetzen"],
      fields: [
        {
          autocomplete: "name",
          id: "name",
          label: "Ihr Name",
          name: "name",
          required: true,
          tag: "input",
          type: "text",
        },
        {
          label: "E-Mail",
          name: "email",
          placeholder: "mail@beispiel.de",
          required: false,
          tag: "input",
          type: "email",
        },
        {
          id: "later",
          label: "Telefon",
          name: "phone",
          required: false,
          tag: "input",
          type: "tel",
        },
        { name: "topic", required: false, tag: "select", type: "select" },
        {
          label: "Nachricht",
          name: "message",
          required: false,
          tag: "textarea",
          type: "textarea",
        },
        { name: "_token", required: false, tag: "input", type: "hidden" },
        {
          id: "privacy",
          name: "privacy",
          required: false,
          tag: "input",
          type: "checkbox",
        },
      ],
      id: "contact",
      method: "post",
    },
    {
      action: "https://firma.de/kontakt/",
      buttons: ["Suchen"],
      fields: [{ name: "s", required: false, tag: "input", type: "search" }],
      method: "get",
    },
  ]);
});

test("keeps a select's options and a textarea's content out of the label around them", async () => {
  const { forms } = await parseHtml(
    `<form><label>Land <select name="country"><option>Deutschland</option><option>Österreich</option></select> wählen</label>
    <label>Nachricht <textarea name="message">Vorgabe</textarea></label>
    <label>E-Mail <input name="email"></label></form>`,
    { forms: true, url }
  );
  expect(forms?.[0]?.fields.map(({ label, name }) => [name, label])).toEqual([
    ["country", "Land wählen"],
    ["message", "Nachricht"],
    ["email", "E-Mail"],
  ]);
});

test("names a field by its aria-label before its label, as a browser does", async () => {
  const { forms } = await parseHtml(
    `<form><label for="a">Sichtbar</label><input id="a" name="a" aria-label="Vorgelesen">
    <label>Umschlossen <input name="b" aria-label="Auch vorgelesen"></label>
    <label for="c">Nur sichtbar</label><input id="c" name="c" aria-label=" "></form>`,
    { forms: true, url }
  );
  expect(forms?.[0]?.fields.map(({ label, name }) => [name, label])).toEqual([
    ["a", "Vorgelesen"],
    ["b", "Auch vorgelesen"],
    ["c", "Nur sichtbar"],
  ]);
});

test("respects the context and marks hidden forms", async () => {
  const { forms } = await parseHtml(
    `<header><form class="search"><input name="s"></form></header>
    <main><form hidden><input name="a"></form><form><input name="b"></form></main>`,
    { context: "main", forms: true, hidden: true, url }
  );
  expect(forms?.map(({ fields, hidden }) => [fields[0]?.name, hidden])).toEqual(
    [
      ["a", true],
      ["b", false],
    ]
  );
});
