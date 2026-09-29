import assert from "node:assert/strict";
import test from "node:test";
import {
  archiveDateFromFilename,
  parseRfqText,
  solicitationFromFilename,
} from "./parse-rfq.js";

test("parses the archive date", () => {
  assert.equal(archiveDateFromFilename("/tmp/CA260927.ZIP"), "2026-09-27");
});

test("formats a DIBBS filename as a solicitation number", () => {
  assert.equal(solicitationFromFilename("SPE2DS26T473K.pdf"), "SPE2DS-26-T-473K");
});

test("extracts the RFQ fields used by the grid", () => {
  const parsed = parseRfqText(
    `
 1. REQUEST NO.  2. DATE ISSUED
   SPE2DS-26-T-473K
   2026 SEP 28
 5. ISSUED BY                                      6. DELIVER BY
     DLA TROOP SUPPORT                             20 DAYS ADO
     MEDICAL SUPPLY CHAIN MD SURG FSF
     700 ROBBINS AVENUE
     Name: Kendall Jones Buyer Code:DKJ0075 Tel: 445-737-3562
   Email: KENDALL.JONES@DLA.MIL
          2026 OCT 05
 ALL OTHER QUESTIONS (SOLICITATION REQUIREMENTS, ITEM DESCRIPTION, AWARD CHOICE, ETC.)
 NORTH AMERICAN INDUSTRY CLASSIFICATION SYSTEM 339113
 SECTION B
 PR: 7018501930
 NSN/MATERIAL:6510015198421

 ITEM DESCRIPTION
 DRESSING,OCCLUSIVE,ADHESIVE

 0001   7018501930     0001       PG    1.000
 DELIVERY (IN DAYS):0020
`,
    "SPE2DS26T473K.pdf",
  );

  assert.deepEqual(parsed, {
    solicitationNumber: "SPE2DS-26-T-473K",
    title: "DRESSING,OCCLUSIVE,ADHESIVE",
    nsn: "6510015198421",
    purchaseRequest: "7018501930",
    quantity: 1,
    unit: "PG",
    issuedDate: "2026-09-28",
    closeDate: "2026-10-05",
    buyerName: "Kendall Jones",
    buyerCode: "DKJ0075",
    buyerEmail: "KENDALL.JONES@DLA.MIL",
    agency: "DLA TROOP SUPPORT",
    supplyChain: "MEDICAL SUPPLY CHAIN MD SURG FSF",
    naics: "339113",
    deliveryDays: 20,
    estimatedUnitPrice: null,
    estimatedValue: null,
    approvedParts: [],
  });
});

test("extracts the alternate Q-series layout", () => {
  const parsed = parseRfqText(
    `
   SPE4A6-26-Q-1495
   2026 SEP 28            FB500441650004
 5. ISSUED BY
     DLA AVIATION                                      100 DAYS ADO
     ASC COMMODITIES DIVISION
     Buyer: KATHERINE ZACHARIAS DKZ0007 Tel: 445-737-7117
     Email: KATHERINE.ZACHARIAS@DLA.MIL
          2026 OCT 05
 SUPPLIES/SERVICES: 3110-00-155-6503
 ITEM DESCRIPTION:  BEARING, ROLLER, CYLINDRICAL
 ITEM NO.   SUPPLIES/SERVICES   QUANTITY        UNIT
 0001       3110-00-155-6503    1.000           EA
`,
    "SPE4A626Q1495.pdf",
  );
  assert.equal(parsed.title, "BEARING, ROLLER, CYLINDRICAL");
  assert.equal(parsed.nsn, "3110-00-155-6503");
  assert.equal(parsed.purchaseRequest, "FB500441650004");
  assert.equal(parsed.quantity, 1);
  assert.equal(parsed.unit, "EA");
  assert.equal(parsed.buyerName, "KATHERINE ZACHARIAS");
  assert.equal(parsed.buyerCode, "DKZ0007");
  assert.equal(parsed.deliveryDays, 100);
});

test("extracts mixed-format buyer codes and bracketed NAICS values", () => {
  const parsed = parseRfqText(
    `
   SPE7M8-26-Q-0215
   2026 AUG 14
 5. ISSUED BY
     DLA LAND AND MARITIME
     ELECTRICAL DEVICES DIV
     Buyer: RICKIE ALLEN PMCM69V Tel: (614) 693-4328
     Email: RICKIE.ALLEN@DLA.MIL
 NORTH AMERICAN INDUSTRY CLASSIFICATION SYSTEM [334413] applies to this solicitation.
`,
    "SPE7M826Q0215.pdf",
  );

  assert.equal(parsed.buyerName, "RICKIE ALLEN");
  assert.equal(parsed.buyerCode, "PMCM69V");
  assert.equal(parsed.naics, "334413");
});

test("extracts parenthesized NAICS values", () => {
  const parsed = parseRfqText(
    "NORTH AMERICAN INDUSTRY CLASSIFICATION SYSTEM (336413) applies to this solicitation.",
    "SPE7L326Q1323.pdf",
  );
  assert.equal(parsed.naics, "336413");
});

test("extracts and deduplicates approved manufacturer parts from section B", () => {
  const parsed = parseRfqText(
    `
SPE7M1-26-T-387M
2026 SEP 28
2026 OCT 08
SECTION B
ITEM DESCRIPTION
CLAMP,LOOP
0GE52    SPE7L126F036T           88.000      14.16000   20260706   N
0HBG3    SPE7L325P2475          498.000      11.77000   20250204   N
0001   7013655465      0001        EA   80.000
CRITICAL APPLICATION ITEM
EATON AEROQUIP LLC 00624 P/N 321-62-475S
EATON AEROQUIP LLC 00624 P/N 321-62-475S
PARKER-HANNIFIN CORPORATION 05779 P/N 928218
SECTION C
CAGE code Part number
`,
    "SPE7M126T387M.pdf",
  );

  assert.deepEqual(parsed.approvedParts, [
    {
      cageCode: "00624",
      partNumber: "321-62-475S",
      manufacturer: "EATON AEROQUIP LLC",
      sourceText: "EATON AEROQUIP LLC 00624 P/N 321-62-475S",
    },
    {
      cageCode: "05779",
      partNumber: "928218",
      manufacturer: "PARKER-HANNIFIN CORPORATION",
      sourceText: "PARKER-HANNIFIN CORPORATION 05779 P/N 928218",
    },
  ]);
  assert.equal(parsed.estimatedUnitPrice, 14.16);
  assert.equal(parsed.estimatedValue, 1_132.8);
});
