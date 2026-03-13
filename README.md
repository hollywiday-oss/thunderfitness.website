# Thunder Fitness Website Prototype

This project includes two connected websites:

1. Public client-facing website
2. Trainer management dashboard

## Pages

- `index.html` - marketing home with video area and rotating reviews
- `start-here.html` - new client consultation intake
- `booking.html` - shared calendar for consultations and sessions
- `client-portal.html` - existing client login, assignment checklists, messages, reviews
- `programs.html` - workout assignment overview
- `reviews.html` - review submission (anonymous or named)
- `about.html` - trainer bio, photo, and location map placeholder
- `trainer/index.html` - trainer dashboard website

## Demo Credentials

Client portal:
- `jordan@example.com` / `1234`
- `taylor@example.com` / `5678`

Trainer dashboard:
- `coach@thunder.fit` / `ThunderAdmin!`

## Notes

- Data is stored in `localStorage`, so both websites share the same demo data in one browser.
- All content is placeholder and ready to replace with real text, media, and integrations.
- Styling is tuned to Thunder Fitness brand colors (charcoal, yellow, gold) for a modern unisex vibe.
- New account sign-up requires email OTP verification before account activation.
- OTP delivery supports EmailJS (recommended for GitHub Pages):
  - Edit `assets/js/email-config.js` and set `serviceId`, `templateId`, `publicKey`.
  - In your EmailJS template, include: `to_email`, `to_name`, `otp_code`, `otp_ttl_minutes`, `app_name`, `from_name`, `reply_to`.
- OTP delivery also supports an optional custom API endpoint via `window.THUNDER_OTP_ENDPOINT` (POST JSON with `email`, `name`, `code`, `ttlMinutes`, `brand`).
- If neither EmailJS nor endpoint is configured, the app runs in demo mode and shows the OTP in the verification notice.
