import {
  decodePDFRawStream,
  PDFArray,
  PDFDocument,
  PDFRawStream,
  type PDFObject,
} from "pdf-lib";

/*
 * Texto dibujado en cada página de un PDF generado con pdf-lib, para que
 * los tests comprueben qué dice el documento sin depender de un visor.
 * pdf-lib escribe cada renglón como `<hex> Tj` en WinAnsi (Windows-1252):
 * se descomprimen los content streams y se decodifica cada renglón.
 */

const SHOW_TEXT = /<([0-9A-Fa-f]*)>\s*Tj/g;
const WIN_ANSI = new TextDecoder("windows-1252");

function decodeHex(hex: string): string {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return WIN_ANSI.decode(bytes);
}

/** Los renglones de texto de cada página, en el orden en que se dibujaron. */
export async function pdfTextByPage(bytes: Uint8Array): Promise<string[][]> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  return doc.getPages().map((page) => {
    const contents = page.node.Contents();
    const streams: (PDFObject | undefined)[] =
      contents instanceof PDFArray
        ? contents.asArray().map((ref) => doc.context.lookup(ref))
        : [contents];
    const lines: string[] = [];
    for (const stream of streams) {
      if (!(stream instanceof PDFRawStream)) continue;
      const source = new TextDecoder("latin1").decode(
        decodePDFRawStream(stream).decode(),
      );
      for (const match of source.matchAll(SHOW_TEXT)) {
        lines.push(decodeHex(match[1] ?? ""));
      }
    }
    return lines;
  });
}

/** Todo el texto del PDF, un renglón por línea. */
export async function pdfText(bytes: Uint8Array): Promise<string> {
  return (await pdfTextByPage(bytes)).flat().join("\n");
}
