# Supabase Guide: Approved Users Only (Invite-Only Access)

This guide shows how to:

1. Restrict your Supabase project so only approved users can access it.
2. Add users by invitation.
3. Prevent accidental auto-creation of users from OTP/magic-link flows.

UI labels can vary slightly by Supabase dashboard version, but the flow is the same.

## Prerequisites

- You have `Owner` or `Admin` access to the Supabase project.
- You can access the project in the Supabase Dashboard.

## Step 1: Turn Off Public Signups

1. Open your project in the Supabase Dashboard.
2. In the left sidebar, click `Authentication`.
3. Open `Settings` (sometimes shown as `Configuration`).
4. In `General configuration`, find `Allow new users to sign up`.
5. Turn this setting **off**.
6. Click `Save`.

Result: New, unknown users can no longer self-register through normal sign-up flows.

## Step 2: Add Approved Users (Invite Flow)

1. In the left sidebar, go to `Authentication` -> `Users`.
2. Click `Invite user`.
3. Enter the user's email address.
4. Send the invite.
5. Repeat for each approved user.

Result: Only users you invite can complete onboarding and sign in.

## Step 3: Prevent OTP/Magic Link from Creating New Users

If your app uses email OTP or magic links, set `shouldCreateUser: false`.
This blocks unknown emails from being silently created by sign-in calls.

```js
await supabase.auth.signInWithOtp({
  email,
  options: { shouldCreateUser: false }
})
```

Result: OTP/magic-link sign-in works only for existing invited users.

## Step 4: Verify the Lockdown Works

1. Try signing up with an email that was **not** invited.
2. Confirm the user is blocked from account creation.
3. Try signing in with an invited user.
4. Confirm sign-in succeeds.

## Optional: Add Database IP Allowlisting (Different from User Approval)

If you also want to restrict **database network access**:

1. Go to `Database` -> `Settings`.
2. Scroll to `Network Restrictions`.
3. Add allowed CIDRs (IPv4 and IPv6 as needed).
4. Save/apply changes.

Important: Network Restrictions protect Postgres/pooler connectivity, not all HTTPS APIs.

## Troubleshooting

- Cannot find `Allow new users to sign up`:
  - Check `Authentication` settings/configuration pages; labels can move between releases.
- Invite fails:
  - Verify SMTP/email configuration and check Auth logs.
- Unknown users still appear:
  - Confirm your client code uses `shouldCreateUser: false` in OTP/magic-link flows.

## Quick Checklist

- [ ] `Allow new users to sign up` is OFF
- [ ] Approved users were added via `Authentication` -> `Users` -> `Invite user`
- [ ] OTP/magic-link calls use `shouldCreateUser: false`
- [ ] Verified non-approved users cannot create accounts
