import { FEEDBACK_PRIORITIES, type CategoryDefinition, type FeedbackPriority } from "@pinpoint-feedback/core";
import { useId, type ReactNode, type Ref } from "react";
import { CATEGORY_DOT, SEGMENTED_CATEGORIES_MAX } from "./categories";
import { PRIORITY_LABELS, type Draft, type DraftField, type FieldErrors } from "./draft";
import { ChevronDownIcon, GlobeIcon } from "./icons";

export interface FeedbackFormProps {
  draft: Draft;
  onChange: (patch: Partial<Draft>) => void;
  onBlurField: (field: DraftField) => void;
  errors: FieldErrors;
  categories: readonly CategoryDefinition[];
  showReporterFields: boolean;
  disabled: boolean;
  titleRef: Ref<HTMLInputElement>;
}

const PRIORITY_DOT: Record<FeedbackPriority, string> = {
  low: "bg-zinc-400",
  medium: "bg-sky-500",
  high: "bg-amber-500",
  critical: "bg-red-500",
};

const inputClass =
  "block w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-subtle shadow-[0_1px_1px_rgb(0_0_0/0.03)] transition-[border-color,box-shadow] duration-150 outline-none hover:border-line-strong focus:border-accent focus:ring-3 focus:ring-accent/20 disabled:opacity-60 aria-invalid:border-danger aria-invalid:focus:ring-danger/20";

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="flex items-baseline justify-between text-xs font-medium text-fg">
        <span>{label}</span>
        {hint ? <span className="font-normal text-fg-subtle">{hint}</span> : null}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function CategoryDot({ category }: { category: CategoryDefinition }) {
  if (!category.color) return null;
  return <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${CATEGORY_DOT[category.color]}`} />;
}

/** Segmented buttons for short lists, a native select for long ones; hidden when there is nothing to choose. */
function CategoryField({
  id,
  categories,
  value,
  disabled,
  onChange,
}: {
  id: string;
  categories: readonly CategoryDefinition[];
  value: string;
  disabled: boolean;
  onChange: (category: string) => void;
}) {
  if (categories.length <= 1) return null;

  if (categories.length > SEGMENTED_CATEGORIES_MAX) {
    const selected = categories.find((c) => c.id === value);
    return (
      <Field id={id} label="Category">
        <div className="relative">
          {selected ? (
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center">
              <CategoryDot category={selected} />
            </span>
          ) : null}
          <select
            id={id}
            name="category"
            className={`${inputClass} appearance-none pr-8 ${selected?.color ? "pl-6.5" : ""}`}
            value={selected ? value : ""}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
          >
            {selected ? null : <option value="" disabled />}
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.label}
              </option>
            ))}
          </select>
          <ChevronDownIcon
            size={14}
            className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-fg-subtle"
          />
        </div>
      </Field>
    );
  }

  return (
    <fieldset className="flex flex-col gap-1.5" disabled={disabled}>
      <legend className="mb-1.5 text-xs font-medium text-fg">Category</legend>
      <div className="flex flex-wrap gap-1.5">
        {categories.map((category) => (
          <label
            key={category.id}
            className="relative inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 py-1 text-xs font-medium text-fg-muted transition-colors duration-150 select-none hover:border-line-strong hover:text-fg has-checked:border-accent has-checked:bg-accent/10 has-checked:text-fg has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent"
          >
            <input
              type="radio"
              name={id}
              value={category.id}
              className="sr-only"
              checked={value === category.id}
              onChange={() => onChange(category.id)}
            />
            <CategoryDot category={category} />
            {category.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function errorProps(id: string, error?: string) {
  return error ? { "aria-invalid": true as const, "aria-describedby": `${id}-error` } : {};
}

export function FeedbackForm({
  draft,
  onChange,
  onBlurField,
  errors,
  categories,
  showReporterFields,
  disabled,
  titleRef,
}: FeedbackFormProps) {
  const uid = useId();
  const ids = {
    title: `${uid}-title`,
    description: `${uid}-description`,
    name: `${uid}-name`,
    email: `${uid}-email`,
    website: `${uid}-website`,
    category: `${uid}-category`,
    priority: `${uid}-priority`,
  };

  return (
    <div className="flex flex-col gap-4">
      <Field id={ids.title} label="Title" error={errors.title}>
        <input
          ref={titleRef}
          id={ids.title}
          name="title"
          type="text"
          required
          aria-required="true"
          autoComplete="off"
          placeholder="What's wrong or what could be better?"
          className={inputClass}
          value={draft.title}
          disabled={disabled}
          onChange={(e) => onChange({ title: e.target.value })}
          onBlur={() => onBlurField("title")}
          {...errorProps(ids.title, errors.title)}
        />
      </Field>

      <Field id={ids.description} label="Description" hint="Optional" error={errors.description}>
        <textarea
          id={ids.description}
          name="description"
          rows={4}
          placeholder="Steps to reproduce, what you expected, what happened…"
          className={`${inputClass} min-h-24 resize-y`}
          value={draft.description}
          disabled={disabled}
          onChange={(e) => onChange({ description: e.target.value })}
          onBlur={() => onBlurField("description")}
          {...errorProps(ids.description, errors.description)}
        />
      </Field>

      <CategoryField
        id={ids.category}
        categories={categories}
        value={draft.category}
        disabled={disabled}
        onChange={(category) => onChange({ category })}
      />

      <fieldset className="flex flex-col gap-1.5" disabled={disabled}>
        <legend className="mb-1.5 text-xs font-medium text-fg">Priority</legend>
        <div className="grid grid-cols-4 gap-0.5 rounded-lg border border-line bg-muted p-0.5">
          {FEEDBACK_PRIORITIES.map((priority) => (
            <label
              key={priority}
              className="relative inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-md px-1.5 py-1 text-xs font-medium text-fg-muted transition-colors duration-150 select-none hover:text-fg has-checked:bg-surface has-checked:text-fg has-checked:shadow-[0_1px_2px_rgb(0_0_0/0.08)] has-focus-visible:outline-2 has-focus-visible:outline-offset-1 has-focus-visible:outline-accent"
            >
              <input
                type="radio"
                name={ids.priority}
                value={priority}
                className="sr-only"
                checked={draft.priority === priority}
                onChange={() => onChange({ priority })}
              />
              <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${PRIORITY_DOT[priority]}`} />
              {PRIORITY_LABELS[priority]}
            </label>
          ))}
        </div>
      </fieldset>

      {showReporterFields ? (
        <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 sm:grid-cols-1 lg:grid-cols-2">
          <Field id={ids.name} label="Name" hint="Optional" error={errors.name}>
            <input
              id={ids.name}
              name="name"
              type="text"
              autoComplete="name"
              className={inputClass}
              value={draft.name}
              disabled={disabled}
              onChange={(e) => onChange({ name: e.target.value })}
              onBlur={() => onBlurField("name")}
              {...errorProps(ids.name, errors.name)}
            />
          </Field>
          <Field id={ids.email} label="Email" hint="Optional" error={errors.email}>
            <input
              id={ids.email}
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              className={inputClass}
              value={draft.email}
              disabled={disabled}
              onChange={(e) => onChange({ email: e.target.value })}
              onBlur={() => onBlurField("email")}
              {...errorProps(ids.email, errors.email)}
            />
          </Field>
        </div>
      ) : null}

      <div aria-hidden="true" className="sr-only">
        <label htmlFor={ids.website}>Website</label>
        <input
          id={ids.website}
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          value={draft.website}
          onChange={(e) => onChange({ website: e.target.value })}
        />
      </div>

      <div className="flex min-w-0 items-center gap-1.5 text-2xs text-fg-subtle">
        <GlobeIcon size={12} className="shrink-0" />
        <span className="sr-only">Page URL:</span>
        <span className="truncate font-mono" title={draft.metadata.url}>
          {draft.metadata.url}
        </span>
      </div>
    </div>
  );
}
