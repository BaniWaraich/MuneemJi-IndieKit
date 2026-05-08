#!/bin/bash

# Next.js 16 Pre-commit Validation Hook
# This script validates Next.js code before allowing commits

set -e

echo "🔍 Running Next.js pre-commit validation..."

# Check for common Next.js 16 issues
check_nextjs_patterns() {
    local file="$1"
    local errors=0
    
    # Check for incorrect async params/searchParams usage
    if grep -q "params\." "$file" 2>/dev/null || grep -q "searchParams\." "$file" 2>/dev/null; then
        if ! grep -q "await params" "$file" 2>/dev/null && ! grep -q "await searchParams" "$file" 2>/dev/null; then
            echo "⚠️  Warning in $file: params and searchParams are Promises in Next.js 16 - use await"
            errors=$((errors + 1))
        fi
    fi
    
    # Check for useState/useEffect in files without 'use client'
    if grep -E "(useState|useEffect|useReducer|useCallback|useMemo)" "$file" >/dev/null 2>&1; then
        if ! grep -q "^'use client'" "$file" && ! grep -q '^"use client"' "$file"; then
            echo "⚠️  Warning in $file: Client hooks found without 'use client' directive"
            errors=$((errors + 1))
        fi
    fi
    
    # Check for 'use server' at file level vs function level
    if grep -q "'use server'" "$file" 2>/dev/null; then
        line_num=$(grep -n "'use server'" "$file" | head -1 | cut -d: -f1)
        if [ "$line_num" -ne 1 ]; then
            echo "ℹ️  Info in $file: 'use server' found inside file - consider file-level directive"
        fi
    fi
    
    # Check for process.env usage in Client Components
    if grep -q "'use client'" "$file" 2>/dev/null || grep -q '"use client"' "$file" 2>/dev/null; then
        if grep -q "process\.env\." "$file" 2>/dev/null; then
            if ! grep -q "process\.env\.NEXT_PUBLIC_" "$file" 2>/dev/null; then
                echo "⚠️  Warning in $file: Non-public env vars in Client Component"
                errors=$((errors + 1))
            fi
        fi
    fi
    
    return $errors
}

# Find all TypeScript/JavaScript files in app directory
total_errors=0
for file in $(find app -type f \( -name "*.tsx" -o -name "*.ts" -o -name "*.jsx" -o -name "*.js" \) 2>/dev/null || true); do
    if [ -f "$file" ]; then
        check_nextjs_patterns "$file" || total_errors=$((total_errors + $?))
    fi
done

# Check for missing error boundaries
if [ -d "app" ]; then
    routes=$(find app -type f -name "page.tsx" -o -name "page.jsx" -o -name "page.ts" -o -name "page.js" | xargs -I {} dirname {})
    for route in $routes; do
        if [ ! -f "$route/error.tsx" ] && [ ! -f "$route/error.jsx" ] && [ ! -f "$route/error.ts" ] && [ ! -f "$route/error.js" ]; then
            echo "ℹ️  Info: No error boundary in $route/"
        fi
    done
fi

# Run type checking if TypeScript is configured
if [ -f "tsconfig.json" ]; then
    echo "📝 Running TypeScript type check..."
    npx tsc --noEmit || {
        echo "❌ TypeScript errors found"
        exit 1
    }
fi

# Run Next.js linting if configured
if [ -f ".eslintrc.json" ] || [ -f ".eslintrc.js" ]; then
    echo "🧹 Running Next.js ESLint..."
    npm run lint || {
        echo "❌ ESLint errors found"
        exit 1
    }
fi

if [ $total_errors -gt 0 ]; then
    echo "❌ Found $total_errors potential issues. Please review before committing."
    exit 1
else
    echo "✅ Next.js validation passed!"
fi