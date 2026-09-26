import {
  ENC_FILTERS_ALL,
  ENC_NO_PLANET_CLASS,
  type EncyclopediaFacetOptions,
  type EncyclopediaFiltersState,
} from "./encyclopediaFilters";
import { useId, useMemo } from "react";
import { Select } from "./ui/Select";

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

/**
 * A labelled {@link Select}. The menu used to be this component's own absolutely-positioned list,
 * which the cockpit theme's `clip-path` on the field cut away entirely (1b04f55): the dropdowns
 * "stopped working" — they opened, invisibly. `Select` portals its menu out of every clipped box.
 */
function FilterSelect({
  fieldId,
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  fieldId: string;
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="ency-filter-field">
      <label className="ency-filter-field__label" htmlFor={fieldId}>
        {label}
      </label>
      <Select id={fieldId} value={value} options={options} onChange={onChange} disabled={disabled} />
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
          label="Genus"
          value={filters.genusKey}
          options={genusOptions}
          onChange={(v) => patch({ genusKey: v })}
          disabled={genusOptions.length <= 1}
        />
        <FilterSelect
          fieldId={`${baseId}-pc`}
          label="Planet class"
          value={filters.planetClass}
          options={planetOptions}
          onChange={(v) => patch({ planetClass: v })}
        />
        <FilterSelect
          fieldId={`${baseId}-at`}
          label="Atmosphere"
          value={filters.atmosphere}
          options={atmoOptions}
          onChange={(v) => patch({ atmosphere: v })}
        />
        <FilterSelect
          fieldId={`${baseId}-volc`}
          label="Volcanism"
          value={filters.volcanism}
          options={volcOpts}
          onChange={(v) => patch({ volcanism: v as EncyclopediaFiltersState["volcanism"] })}
        />
        <FilterSelect
          fieldId={`${baseId}-star`}
          label="Host star class"
          value={filters.starType}
          options={starOpts}
          onChange={(v) => patch({ starType: v })}
          disabled={starOpts.length <= 1}
        />
        <FilterSelect
          fieldId={`${baseId}-press`}
          label="Pressure class"
          value={filters.pressureCat}
          options={pressOpts}
          onChange={(v) => patch({ pressureCat: v as EncyclopediaFiltersState["pressureCat"] })}
        />
        <FilterSelect
          fieldId={`${baseId}-geo`}
          label="Geological signal"
          value={filters.geoSignal}
          options={geoOpts}
          onChange={(v) => patch({ geoSignal: v })}
          disabled={geoOpts.length <= 1}
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
