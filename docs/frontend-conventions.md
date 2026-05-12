# Frontend Conventions — Muneem Ji

Design system, component patterns, and form-validation rules for `app/(...)/` and `components/**`. Loaded by the `frontend` skill. Not loaded by default into other Claude sessions.

---

## Design System

All UI must follow this system. Do not deviate to generic Tailwind defaults.

### Tailwind Config

Custom colour tokens are defined in `tailwind.config.ts`. Do not redefine them. Use these class names as written:

```
bg-primary          → #1C4ED8  (blue-700)
bg-primary-hover    → #1D4FC4  (blue-800)
bg-primary-light    → #EFF6FF  (blue-50)
```

All other colours use Tailwind's standard palette (`neutral-900`, `green-600`, etc.).

### Colour Palette

```
Primary:        #1C4ED8  (blue-700)   — buttons, links, active states
Primary hover:  #1D4FC4  (blue-800)
Primary light:  #EFF6FF  (blue-50)    — selected rows, subtle highlights

Neutral 900:    #111827  — primary text
Neutral 700:    #374151  — secondary text, labels
Neutral 500:    #6B7280  — placeholder, disabled text
Neutral 300:    #D1D5DB  — borders, dividers
Neutral 100:    #F3F4F6  — page background, table stripes
White:          #FFFFFF  — card/panel backgrounds

Success:        #16A34A  (green-600)
Success light:  #F0FDF4  (green-50)

Warning:        #D97706  (amber-600)
Warning light:  #FFFBEB  (amber-50)

Error:          #DC2626  (red-600)
Error light:    #FEF2F2  (red-50)

Accent:         #7C3AED  (violet-600) — India/GST badges, jurisdiction indicators
```

### Typography

```
Font: Inter (system fallback: -apple-system, sans-serif)

Page title (h1):    text-2xl font-semibold text-neutral-900   (24px / 600)
Section title (h2): text-lg font-semibold text-neutral-900    (18px / 600)
Card title (h3):    text-base font-medium text-neutral-900    (16px / 500)
Body:               text-sm text-neutral-700                  (14px / 400)
Caption / meta:     text-xs text-neutral-500                  (12px / 400)
```

### Layout

```
Page wrapper:    max-w-7xl mx-auto px-6 py-8
Card:            bg-white rounded-xl border border-neutral-200 shadow-sm p-6
Section spacing: space-y-6 between major sections
Sidebar width:   w-64 (fixed)
Content area:    flex-1 min-w-0
```

### Component Patterns

**Primary button**

```tsx
<button className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-white
  text-sm font-medium rounded-lg hover:bg-primary-hover
  focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2
  disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
```

**Secondary button**

```tsx
<button className="inline-flex items-center gap-2 px-4 py-2 bg-white text-neutral-700
  text-sm font-medium rounded-lg border border-neutral-300
  hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2
  disabled:opacity-50 transition-colors">
```

**Input field (default)**

```tsx
<input className="focus:ring-primary w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 transition-colors placeholder:text-neutral-400 focus:border-transparent focus:ring-2 focus:outline-none" />
```

**Input field (error state)**

```tsx
<input className="w-full rounded-lg border border-red-500 bg-white px-3 py-2 text-sm text-neutral-900 transition-colors placeholder:text-neutral-400 focus:border-transparent focus:ring-2 focus:ring-red-500 focus:outline-none" />
```

**Status badge**

```tsx
// Pending
<span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium
  bg-amber-50 text-amber-700 border border-amber-200">Pending</span>

// Complete
<span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium
  bg-green-50 text-green-700 border border-green-200">Complete</span>

// Flagged
<span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium
  bg-red-50 text-red-700 border border-red-200">Flagged</span>
```

---

## Form Validation Rules

Every form must meet this standard without exception.

### Field-level inline errors

Every input that can be invalid must show an inline error message **beneath the field**.

```tsx
const [errors, setErrors] = useState<Record<string, string>>({});

{
  errors.email && <p className="mt-1 text-xs text-red-600">{errors.email}</p>;
}
```

### Error message standards

Write human messages, not technical ones.

```
CORRECT:
"Enter a valid email address"
"Password must be at least 8 characters"
"GSTIN must be 15 characters (e.g. 22AAAAA0000A1Z5)"
"This email is already registered — sign in instead"

WRONG:
"Invalid input"
"Validation failed"
"email: String must match pattern"
```

### Validation timing

- Validate on blur (when the user leaves a field) — not on every keystroke.
- Validate all fields on submit attempt. Show all errors at once.
- Clear a field's error as soon as the user starts typing in it again.

```tsx
const handleBlur = (field: string, value: string) => {
  const fieldError = validateField(field, value);
  setErrors((prev) => ({ ...prev, [field]: fieldError }));
};

const handleChange = (field: string, value: string) => {
  setValue(field, value);
  if (errors[field]) setErrors((prev) => ({ ...prev, [field]: '' }));
};
```

### Submit button state

```tsx
<button disabled={isLoading}>{isLoading ? 'Creating account…' : 'Create account'}</button>
```

### API error handling

Map API error codes to user-facing messages. Never show raw API errors.

```tsx
const API_ERRORS: Record<string, string> = {
  EMAIL_ALREADY_EXISTS: 'An account with this email already exists. Sign in instead.',
  INVALID_GSTIN: 'Check the GSTIN — it should be 15 characters in the format 22AAAAA0000A1Z5.',
  WEAK_PASSWORD: 'Use at least 8 characters including a number.',
  INVITE_EXPIRED: 'This invite link has expired. Ask your accountant to send a new one.',
};

const message = API_ERRORS[error.code] ?? 'Something went wrong. Please try again.';
```
