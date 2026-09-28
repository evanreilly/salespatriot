import assert from "node:assert/strict";
import test from "node:test";
import {
  enrichManifestFromBatch,
  hasNextResultsPage,
  parseApprovedSources,
  parseArchiveListings,
  parseCsvLine,
  parseIndexFile,
  parseLiveListings,
  parseResultCount,
} from "./dibbs-formats.js";

test("discovers a complete archive triplet and ignores incomplete days", () => {
  const html = `
    <a href="https://dibbs2.bsm.dla.mil/Downloads/RFQ/Archive/ca260927.zip">PDFs</a>
    <a href="https://dibbs2.bsm.dla.mil/Downloads/RFQ/Archive/in260927.txt">Index</a>
    <a href="https://dibbs2.bsm.dla.mil/Downloads/RFQ/Archive/bq260927.zip">Batch</a>
    <a href="https://dibbs2.bsm.dla.mil/Downloads/RFQ/Archive/ca260926.zip">Incomplete</a>`;
  assert.deepEqual(parseArchiveListings(html), [
    {
      date: "2026-09-27",
      archiveUrl: "https://dibbs2.bsm.dla.mil/Downloads/RFQ/Archive/ca260927.zip",
      indexUrl: "https://dibbs2.bsm.dla.mil/Downloads/RFQ/Archive/in260927.txt",
      batchUrl: "https://dibbs2.bsm.dla.mil/Downloads/RFQ/Archive/bq260927.zip",
    },
  ]);
});

test("parses live result rows and ASP.NET pagination", () => {
  const html = `<span id="ctl00_cph1_lblRecCount">Records Found: <strong> 1,713</strong></span><table><tr><td>
    <a href="https://dibbs2.bsm.dla.mil/Downloads/RFQ/4/SPE1C126T1814.PDF">SPE1C1-26-T-1814</a>
    <span id="ctl00_cph1_grdRfqSearch_ctl02_lblNomenclature">AIRCRAFT PART &amp; FITTING</span>
    <span id="ctl00_cph1_grdRfqSearch_ctl02_lblNsn">1560-01-234-5678</span>
  </td></tr></table><a href="javascript:__doPostBack('ctl00$cph1$grdRfqSearch','Page$2')">2</a>`;
  assert.deepEqual(parseLiveListings(html), [
    {
      solicitationNumber: "SPE1C1-26-T-1814",
      title: "AIRCRAFT PART & FITTING",
      nsn: "1560012345678",
      pdfUrl: "https://dibbs2.bsm.dla.mil/Downloads/RFQ/4/SPE1C126T1814.PDF",
    },
  ]);
  assert.equal(hasNextResultsPage(html, 1), true);
  assert.equal(hasNextResultsPage(html, 2), false);
  assert.equal(parseResultCount(html), 1713);
});

test("parses the fixed-width index and enriches it from batch files", () => {
  const line = [
    fixed("SPE1C126T1814", 13),
    fixed("1560-01-234-5678", 46),
    fixed("009876543", 13),
    fixed("10/05/26", 8),
    fixed("SPE1C126T1814.PDF", 19),
    fixed("25", 7),
    fixed("EA", 2),
    fixed("AIRCRAFT PART", 21),
    fixed("AB123", 5),
  ].join("");
  const records = parseIndexFile(line);
  assert.equal(records.length, 1);
  assert.equal(records[0].closeDate, "2026-10-05");
  assert.equal(records[0].quantity, 25);

  const batch = new Array(121).fill("");
  batch[0] = "SPE1C126T1814";
  batch[45] = "009876543";
  batch[46] = "1560012345678";
  batch[47] = "EA";
  batch[48] = "25";
  batch[50] = "90";
  enrichManifestFromBatch(
    records,
    batch.map(csvField).join(","),
    '1560012345678,00624,"321-62,475S","Eaton, LLC"',
  );
  assert.equal(records[0].deliveryDays, 90);
  assert.deepEqual(records[0].approvedParts[0], {
    cageCode: "00624",
    partNumber: "321-62,475S",
    manufacturer: "Eaton, LLC",
    sourceText: "Eaton, LLC 00624 P/N 321-62,475S",
  });
});

test("CSV and approved-source parsing handle quotes and deduplication", () => {
  assert.deepEqual(parseCsvLine('a,"b,c","d""e"'), ["a", "b,c", 'd"e']);
  const parts = parseApprovedSources("123,1A2B3,P-1,Maker\n123,1A2B3,P-1,Maker");
  assert.equal(parts.get("123")?.length, 1);
});

function fixed(value: string, width: number) {
  return value.padEnd(width).slice(0, width);
}

function csvField(value: string) {
  return value.includes(",") ? `"${value.replaceAll('"', '""')}"` : value;
}
