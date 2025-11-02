# CMS201 Code Review

## Executive Summary

**Overall Assessment**: The codebase demonstrates solid serverless architecture but has several critical security vulnerabilities and API design inconsistencies that need immediate attention.

**Risk Level**: MEDIUM-HIGH
**Priority Issues**: 4 Critical, 6 High, 3 Medium

---

## Critical Security Issues

### 1. **Incomplete User Authorization (CRITICAL)**
**Location**: `src/index.js:263-264`
```javascript
else if (!env.settings.oauth_users.includes(user))
    endPoint = UNSECURE_PATHS["GET /auth/login"];
```
**Issue**: User validation was recently added but may not cover all authenticated endpoints consistently.
**Fix**: Audit all auth-required endpoints for consistent user validation.

### 2. **Missing Rate Limiting (HIGH)**
**Location**: All API endpoints
**Issue**: No rate limiting on any endpoints, vulnerable to DoS attacks.
**How to fix**: Add rate limiting rules in Cloudflare dashboard under Security > WAF > Rate limiting rules.

### 3. **No File Size Limits (HIGH)**
**Location**: `src/index.js:140-147` (addFile endpoint)
**Issue**: File uploads have no size restrictions, could exhaust Durable Object memory.
**How to fix**: Add size check before processing: `Example: if (data.byteLength > 10 * 1024 * 1024) throw new Error("File too large");` in the addFile function.

---

## API Design Issues

### 1. **Inconsistent Route Naming (MEDIUM)**
**Current**: `/api/addEvent`, `/api/addFile`
**How to fix**: Update route definitions in `index.js` to use kebab-case: `/api/add-event`, `/api/add-file`. This follows RESTful conventions.

### 2. **Wrong HTTP Methods (HIGH)**
**Issue**: Some operations use GET when they should use POST
**How to fix**: Change `/api/backup` from GET to POST since it triggers an action. Update the route definition and any client calls.

---

## Authentication & Authorization

### Current State:
- Google OAuth implementation is secure
- Bearer token validation for GitHub endpoints works correctly
- Session management is functional

### Issues to Address:
- **No session timeout**: Sessions never expire, potential security risk
- **How to fix**: Add session expiration check in auth validation, expire after 24 hours

---

## Data Storage & Backup

### Strengths:
- Dual storage system (Durable Objects + GitHub) provides redundancy
- Automatic daily backups via GitHub Actions
- SQLite implementation handles current scale well

### Security Concerns:
- **GitHub PAT tokens in plaintext**: Stored without encryption in environment variables
- **How to fix**: Use Cloudflare's encrypted environment variables feature in production

---

## High-Risk Areas

### 1. **GitHub Sync Process**
**Risk**: Multi-step sync operation can fail partially, leaving inconsistent state
**How to fix**: Add error handling and rollback mechanism in `syncEnd()` function

### 2. **File Upload Pipeline** 
**Risk**: No transaction rollback if upload fails after database insert
**How to fix**: Implement try-catch with cleanup in `addFile()` function

---

## Priority Actions

### Must Fix Before Production:
1. **Add file size limits**
2. **Implement rate limiting** - Use Cloudflare dashboard
3. **Fix HTTP methods** - Change backup endpoint to POST
4. **Add session timeout**

### Nice to Have:
1. **Standardize route naming** - Use kebab-case
2. **Add input validation** - Validate JSON payloads

---

## Overall Assessment

**Architecture**: Solid serverless design with appropriate technology choices
**Security**: Needs immediate attention on file limits and rate limiting
**Code Quality**: Clean and maintainable, follows good practices

**Recommendation**: Fix the 4 priority items above before production deployment. The core architecture is sound.
