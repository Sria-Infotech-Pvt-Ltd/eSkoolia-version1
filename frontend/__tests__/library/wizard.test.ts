import { emptyWizard, firstInvalidStep, stepForField, toBookInput, totalValue, validateWizardStep, type WizardData } from "@/components/library/catalogue/wizard";
import { parseBulkText } from "@/components/library/catalogue/bulkParse";
import { code39Bars, isEncodable } from "@/components/library/catalogue/code39";
import { colorVar, nextColorKey } from "@/components/library/catalogue/colors";

const valid = (): WizardData => ({ ...emptyWizard(), title: "Wonder", category: "3", age_band: "middle", copies_count: "2" });

describe("validateWizardStep", () => {
  it("requires a title on step 1", () => {
    expect(validateWizardStep(0, emptyWizard())).toEqual({ title: "Title is required." });
    expect(validateWizardStep(0, { ...emptyWizard(), title: "   " }).title).toBeDefined();
    expect(validateWizardStep(0, valid())).toEqual({});
  });

  it("checks the publication year only when given", () => {
    expect(validateWizardStep(0, { ...valid(), publication_year: "99" }).publication_year).toBeDefined();
    expect(validateWizardStep(0, { ...valid(), publication_year: "2017" })).toEqual({});
  });

  it("requires category, age band and at least one reader on step 2", () => {
    const errors = validateWizardStep(1, { ...emptyWizard(), for_students: false, for_teachers: false, for_staff: false });
    expect(Object.keys(errors).sort()).toEqual(["age_band", "audience", "category"]);
    expect(validateWizardStep(1, { ...valid(), for_students: false, for_teachers: true, for_staff: false })).toEqual({});
  });

  it("requires at least one copy when creating", () => {
    for (const bad of ["", "0", "-1", "1.5", "abc", "501"]) {
      expect(validateWizardStep(2, { ...valid(), copies_count: bad }).copies_count).toBeDefined();
    }
    expect(validateWizardStep(2, { ...valid(), copies_count: "1" })).toEqual({});
  });

  it("allows zero extra copies when editing", () => {
    expect(validateWizardStep(2, { ...valid(), copies_count: "0" }, { editing: true })).toEqual({});
    expect(validateWizardStep(2, { ...valid(), copies_count: "0" }).copies_count).toBeDefined();
  });

  it("validates cost as a non-negative amount with two decimals", () => {
    expect(validateWizardStep(2, { ...valid(), cost_per_copy: "199.50" })).toEqual({});
    for (const bad of ["-1", "abc", "1.234"]) {
      expect(validateWizardStep(2, { ...valid(), cost_per_copy: bad }).cost_per_copy).toBeDefined();
    }
  });

  it("has no rules on the source and review steps", () => {
    expect(validateWizardStep(3, emptyWizard())).toEqual({});
    expect(validateWizardStep(4, emptyWizard())).toEqual({});
  });
});

describe("wizard helpers", () => {
  it("finds the first step that still has errors", () => {
    expect(firstInvalidStep(valid())).toBeNull();
    expect(firstInvalidStep({ ...valid(), category: "" })).toBe(1);
    expect(firstInvalidStep({ ...valid(), title: "", copies_count: "0" })).toBe(0);
  });

  it("maps server field names to the step they are entered on", () => {
    expect(stepForField("title")).toBe(0);
    expect(stepForField("category")).toBe(1);
    expect(stepForField("copies_count")).toBe(2);
    expect(stepForField("rack")).toBe(3);
    expect(stepForField("something_else")).toBeNull();
  });

  it("builds the request body", () => {
    const body = toBookInput({ ...valid(), publication_year: "2012", source: "donated", donor_name: " Mrs A ", vendor_name: "ignored" });
    expect(body).toMatchObject({ title: "Wonder", category: 3, age_band: "middle", publication_year: 2012, donor_name: "Mrs A", vendor_name: "" });
    expect(toBookInput(valid()).publication_year).toBeNull();
  });

  it("shows the total value", () => {
    expect(totalValue({ ...valid(), copies_count: "3", cost_per_copy: "199.5" })).toBe("598.50");
    expect(totalValue({ ...valid(), copies_count: "x" })).toBe("0.00");
  });
});

describe("parseBulkText", () => {
  it("reads comma and tab separated lines and skips blanks and a header", () => {
    const rows = parseBulkText('Title, Author, Category, Copies, Cost\nMatilda, Roald Dahl, Fiction, 3, 199.5\n\n"Atlas, Big"\tMaps\tReference\t\t850');
    expect(rows).toEqual([
      { title: "Matilda", author: "Roald Dahl", category: "Fiction", copies: "3", cost: "199.5" },
      { title: "Atlas, Big", author: "Maps", category: "Reference", copies: "", cost: "850" },
    ]);
  });

  it("leaves missing trailing cells undefined for server defaults", () => {
    expect(parseBulkText("Only title, Someone, Fiction")[0]).toMatchObject({ copies: undefined, cost: undefined });
  });

  it("does not clean formula characters: the server neutralises them", () => {
    expect(parseBulkText("=SUM(A1), @x, Fiction")[0].title).toBe("=SUM(A1)");
  });
});

describe("code39", () => {
  it("encodes library copy codes", () => {
    expect(isEncodable("LIB-FIC-0001/C1")).toBe(true);
    expect(isEncodable("lib-fic-0001/c1")).toBe(true);
    expect(isEncodable("has_underscore")).toBe(false);
    expect(isEncodable("*")).toBe(false);
    expect(isEncodable("")).toBe(false);
  });

  it("draws start and stop characters around the text, five bars per character", () => {
    const { bars, width } = code39Bars("A");
    expect(bars).toHaveLength(15); // * A *
    expect(width).toBeGreaterThan(0);
    expect(code39Bars("é").bars).toHaveLength(0);
  });
});

describe("category colours", () => {
  it("maps a key to a CSS variable and falls back for unknown keys", () => {
    expect(colorVar("rose")).toBe("var(--cat-rose)");
    expect(colorVar("#ff0000")).toBe("var(--ink-4)");
    expect(colorVar("")).toBe("var(--ink-4)");
  });

  it("picks the next unused key", () => {
    expect(nextColorKey([])).toBe("rose");
    expect(nextColorKey(["rose", "orange", ""])).toBe("amber");
    expect(nextColorKey(["rose", "orange", "amber", "lime", "emerald", "teal", "sky", "indigo", "violet", "slate", "rose"])).toBe("orange");
  });
});
