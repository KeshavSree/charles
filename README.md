# Charles

A free, open-source job application autofill tool — the parts of Simplify that matter, without the paywall.

---

## what's built 
### This is good architecture, and what I believe to be one of the hardest technical parts
- Chrome extension: one-click autofill for Workday applications, merging your info store and resume profile
- based on a detector/strategy pattern: detectors recognize DOM fields and tag each with a semantic role and widget type; 
- strategies are keyed by widget type and know how to fill it. adding a new ATS or widget type is a self-contained unit

### This is all POC, and all needs improvement probably
- resume parser: upload a PDF and it extracts contact info, experience, and education into a structured profile
- - job scraper: scrapes Greenhouse, Lever, and Ashby job boards on click or a configurable interval
- user info store: a flat record of everything a job form might ask 
- REST API: FastAPI backend tying it all together; supports jobs, resumes, profiles, and user info
- dashboard: Next.js frontend to browse jobs, manage resumes, and edit your info

---

## what's next

see `roadmap.md`