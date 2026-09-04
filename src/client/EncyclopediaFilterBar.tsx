import {
  ENC_FILTERS_ALL,
  ENC_NO_PLANET_CLASS,
  type EncyclopediaFacetOptions,
  type EncyclopediaFiltersState,
} from "./encyclopediaFilters";
import { useEffect, useId, useMemo, useRef, useState } from "react";

/**
 * The seven facet dropdowns.
 *
 * They used to sit in a grid above the list, where they cost 219 px of a 787 px modal — the
 * results got 501 px, less than a third of the window. As a side rail they are visible the whole
 * time you scroll and take none of the list's height.
 *
 * Search, the result count, the active-filter chips and "Clear all" live in the list's own toolbar
 * (see EncyclopediaModal): they answer "what am I looking at", not "what can I narrow by".
 */

type SelectOption = { value: string; label: string };

function FilterSelect({
  fieldId,
  label,
  value,
  options,
  onChange,
  disabled,
  openId,
  onOpenChange,
  instanceId,
}: {
  fieldId: string;
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (v: string) => void;
  disabled?: boolean;
  openId: string | null;
  onOpenChange: (id: string | null) => void;
  instanceId: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const open = openId === instanceId;

  const curLabel = useMemo(
    () => options.find((o) => o.value === value)?.label ?? options[0]?.label ?? "—",
    [options, value],
  );

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) onOpenChange(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(null);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onOpenChange]);

  return (
    <div className="ency-filter-field" ref={rootRef}>
      <label className="ency-filter-field__label" htmlFor={fieldId}>
        {label}
      </label>
      <button
        id={fieldId}
        type="button"
        className="ency-filter-field__control"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => !disabled && onOpenChange(open ? null : instanceId)}
      >
        <span className="ency-filter-field__value">{curLabel}</span>
        <span className="ency-filter-field__chev" aria-hidden>
          ▾
        </span>
      </button>
      {open ? (
        <ul className="ency-filter-field__menu" role="listbox">
          {options.map((o) => (
            <li key={o.value}>
              <button
                type="button"
                role="option"
                className={`ency-filter-field__opt${o.value === value ? " is-active" : ""}`}
                aria-selected={o.value === value}
                onClick={() => {
                  onChange(o.value);
                  onOpenChange(null);
                }}
              >
                <span className="ency-filter-field__tick" aria-hidden>
                  {o.value === value ? "✓" : ""}
                </span>
                {o.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function EncyclopediaFilterBar({
  filters,
  onFiltersChange,
  facets,
  genusLabels,
  bodyPlanetClass,
}: {
  filters: EncyclopediaFiltersState;
  onFiltersChange: (next: EncyclopediaFiltersState) => void;
  facets: EncyclopediaFacetOptions;
  genusLabels: string[];
  bodyPlanetClass?: string | null;
}) {
  const baseId = useId().replace(/:/g, "");
  const [openSelect, setOpenSelect] = useState<string | null>(null);

  const patch = (p: Partial<EncyclopediaFiltersState>) => onFiltersChange({ ...filters, ...p });

  const genusOptions: SelectOption[] = useMemo(
    () => [
      { value: ENC_FILTERS_ALL, label: "All genera" },
      ...genusLabels.map((g) => ({ value: g, label: g })),
    ],
    [genusLabels],
  );

  const planetOptions: SelectOption[] = useMemo(() => {
    const out: SelectOption[] = [{ value: ENC_FILTERS_ALL, label: "Any planet class" }];
    if (facets.hasNoPlanetClassRows) {
      out.push({
        value: ENC_NO_PLANET_CLASS,
        label: "No planet-class list",
      });
    }
    for (const p of facets.planetClasses) {
      out.push({ value: p, label: p });
    }
    const seen = new Set(out.map((o) => o.value));
    if (
      filters.planetClass !== ENC_FILTERS_ALL &&
      filters.planetClass !== ENC_NO_PLANET_CLASS &&
      !seen.has(filters.planetClass)
    ) {
      out.push({ value: filters.planetClass, label: filters.planetClass });
    }
    return out;
  }, [facets.planetClasses, facets.hasNoPlanetClassRows, filters.planetClass]);

  const atmoOptions: SelectOption[] = useMemo(
    () => [{ value: ENC_FILTERS_ALL, label: "Any atmosphere" }, ...facets.atmospheres],
    [facets.atmospheres],
  );

  const volcOpts: SelectOption[] = [
    { value: ENC_FILTERS_ALL, label: "Any" },
    { value: "REQUIRED", label: "Volcanism required" },
  ];

  const starOpts: SelectOption[] = useMemo(
    () => [{ value: ENC_FILTERS_ALL, label: "Any host star / class" }, ...facets.hostStar],
    [facets.hostStar],
  );

  const pressOpts: SelectOption[] = [
    { value: ENC_FILTERS_ALL, label: "Any pressure class" },
    { value: "thin", label: "Thin atmosphere" },
    { value: "thick", label: "Thick atmosphere" },
  ];

  const geoOpts: SelectOption[] = useMemo(
    () => [
      { value: ENC_FILTERS_ALL, label: "Any geological signal" },
      ...facets.geoSignals.map((g) => ({ value: g, label: g })),
    ],
    [facets.geoSignals],
  );

  return (
    <div className="encyclopedia-filters">
      {bodyPlanetClass?.trim() ? (
        <button
          type="button"
          className="encyclopedia-filters__chip"
          title="Set the planet class filter from the current BODY tab"
          onClick={() => patch({ planetClass: bodyPlanetClass.trim() })}
        >
          Use BODY: {bodyPlanetClass.trim()}
        </button>
      ) : null}

      <div className="encyclopedia-filters__grid">
        <FilterSelect
          fieldId={`${baseId}-genus`}
          instanceId={`${baseId}-genus`}
          label="Genus"
          value={filters.genusKey}
          options={genusOptions}
          onChange={(v) => patch({ genusKey: v })}
          disabled={genusOptions.length <= 1}
          openId={openSelect}
          onOpenChange={setOpenSelect}
        />
        <FilterSelect
          fieldId={`${baseId}-pc`}
          instanceId={`${baseId}-pc`}
          label="Planet class"
          value={filters.planetClass}
          options={planetOptions}
          onChange={(v) => patch({ planetClass: v })}
          openId={openSelect}
          onOpenChange={setOpenSelect}
        />
        <FilterSelect
          fieldId={`${baseId}-at`}
          instanceId={`${baseId}-at`}
          label="Atmosphere"
          value={filters.atmosphere}
          options={atmoOptions}
          onChange={(v) => patch({ atmosphere: v })}
          openId={openSelect}
          onOpenChange={setOpenSelect}
        />
        <FilterSelect
          fieldId={`${baseId}-volc`}
          instanceId={`${baseId}-volc`}
          label="Volcanism"
          value={filters.volcanism}
          options={volcOpts}
          onChange={(v) => patch({ volcanism: v as EncyclopediaFiltersState["volcanism"] })}
          openId={openSelect}
          onOpenChange={setOpenSelect}
        />
        <FilterSelect
          fieldId={`${baseId}-star`}
          instanceId={`${baseId}-star`}
          label="Host star class"
          value={filters.starType}
          options={starOpts}
          onChange={(v) => patch({ starType: v })}
          disabled={starOpts.length <= 1}
          openId={openSelect}
          onOpenChange={setOpenSelect}
        />
        <FilterSelect
          fieldId={`${baseId}-press`}
          instanceId={`${baseId}-press`}
          label="Pressure class"
          value={filters.pressureCat}
          options={pressOpts}
          onChange={(v) => patch({ pressureCat: v as EncyclopediaFiltersState["pressureCat"] })}
          openId={openSelect}
          onOpenChange={setOpenSelect}
        />
        <FilterSelect
          fieldId={`${baseId}-geo`}
          instanceId={`${baseId}-geo`}
          label="Geological signal"
          value={filters.geoSignal}
          options={geoOpts}
          onChange={(v) => patch({ geoSignal: v })}
          disabled={geoOpts.length <= 1}
          openId={openSelect}
          onOpenChange={setOpenSelect}
        />
      </div>
      {/* 144 px of explanation that most sessions never need — folded, it stops crowding the
          seven controls it describes. */}
      <details className="encyclopedia-filters__help">
        <summary className="encyclopedia-filters__help-summary">How these filters work</summary>
        <p className="encyclopedia-filters__note dim tiny">
          Filters use spawn criteria from each species JSON (same fields as matching); multiple filters
          combine with AND. Atmosphere “Vacuum” matches rows that allow airless worlds. “No planet-class list”
          finds atmosphere-only gates (e.g. many bacterium rows). Host star class uses codex star-type
          fragments (substring match, like the matcher) plus spectral letters from the feeder colour map when
          listed on the row.
        </p>
      </details>
    </div>
  );
}
