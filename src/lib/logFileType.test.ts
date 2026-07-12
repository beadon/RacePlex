import { describe, it, expect } from "vitest";
import { logFileExtension, logFileTypeLabel } from "./logFileType";

describe("logFileExtension", () => {
  it("returns the lowercased extension", () => {
    expect(logFileExtension("session.VBO")).toBe("vbo");
    expect(logFileExtension("LOG001.dove")).toBe("dove");
  });

  it("uses only the final extension", () => {
    expect(logFileExtension("my.session.dovex")).toBe("dovex");
  });

  it("ignores directories in the path", () => {
    expect(logFileExtension("folder.name/log")).toBe("");
    expect(logFileExtension("folder.name/log.ibt")).toBe("ibt");
  });

  it("returns empty for names without an extension", () => {
    expect(logFileExtension("logfile")).toBe("");
    expect(logFileExtension("trailingdot.")).toBe("");
    expect(logFileExtension(".hidden")).toBe("");
  });
});

describe("logFileTypeLabel", () => {
  it("maps known extensions to friendly labels", () => {
    expect(logFileTypeLabel("a.dove")).toBe("Dove");
    expect(logFileTypeLabel("a.dovex")).toBe("Dovex");
    expect(logFileTypeLabel("a.xrk")).toBe("XRK");
    expect(logFileTypeLabel("a.xrz")).toBe("XRZ");
    expect(logFileTypeLabel("a.ibt")).toBe("iRacing");
    expect(logFileTypeLabel("a.vbo")).toBe("VBO");
    expect(logFileTypeLabel("a.ld")).toBe("MoTeC");
    expect(logFileTypeLabel("a.ubx")).toBe("UBX");
    expect(logFileTypeLabel("a.nmea")).toBe("NMEA");
    expect(logFileTypeLabel("a.csv")).toBe("CSV");
    expect(logFileTypeLabel("a.txt")).toBe("TXT");
  });

  it("uppercases unknown extensions", () => {
    expect(logFileTypeLabel("a.gpx")).toBe("GPX");
  });

  it("returns empty when there is no extension", () => {
    expect(logFileTypeLabel("logfile")).toBe("");
  });
});
