import assert from "node:assert/strict";
import test from "node:test";
import { strToU8, zipSync } from "fflate";
import { extractSpreadsheetContext, isExcelWorkbook, isLegacyExcelWorkbook } from "../lib/spreadsheet-context";

export function xlsxFixture() {
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
        <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
        <Default Extension="xml" ContentType="application/xml"/>
        <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
        <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
      </Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
      </Relationships>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <sheets><sheet name="Dados" sheetId="1" r:id="rId1"/></sheets>
      </workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
      </Relationships>`),
    "xl/worksheets/sheet1.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
        <sheetData>
          <row r="1"><c r="A1" t="inlineStr"><is><t>Código</t></is></c><c r="B1" t="inlineStr"><is><t>Valor</t></is></c></row>
          <row r="2"><c r="A2" t="inlineStr"><is><t>INDEV_EXCEL_OK</t></is></c><c r="B2"><v>42</v></c></row>
          <row r="3"><c r="A3" t="inlineStr"><is><t>segunda linha</t></is></c><c r="B3"><v>7</v></c></row>
        </sheetData>
      </worksheet>`),
  };
  return zipSync(files, { level: 0 });
}

test("reconhece Excel moderno e rejeita o formato legado", () => {
  assert.equal(isExcelWorkbook({ name: "dados.XLSX", type: "" } as File), true);
  assert.equal(isLegacyExcelWorkbook({ name: "dados.xlsx", type: "application/vnd.ms-excel" } as File), false);
  assert.equal(isLegacyExcelWorkbook({ name: "dados.xls", type: "" } as File), true);
});

test("extrai abas e células de um xlsx para contexto textual", async () => {
  const bytes = xlsxFixture();
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const file = {
    name: "teste.xlsx",
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    arrayBuffer: async () => arrayBuffer,
  } as File;
  const context = await extractSpreadsheetContext(file);

  assert.equal(context.sheetCount, 1);
  assert.equal(context.rowCount, 3);
  assert.equal(context.summary, "1 planilha · 3 linhas");
  assert.match(context.text, /Planilha "Dados"/);
  assert.match(context.preview, /INDEV_EXCEL_OK/);
  assert.match(context.preview, /42/);
});
