# Publishing Finora on iOS (local build, no Expo cloud)

Everything below builds on this Mac with Xcode. Expo SDK 58, bundle id `com.ahadjeyemby.finora` (change it in `app.json` first if you want another; it can never change after the first upload).

## What is already done in the repo

- `app.json`: bundle identifier, build number, iPhone and iPad (`supportsTablet`; iPhone portrait only, iPad all orientations), encryption declaration (`ITSAppUsesNonExemptEncryption = false`, the app only uses HTTPS), privacy manifest for the required-reason APIs, camera and photo permission texts (no microphone).
- App icon: 1024x1024 light, dark and tinted PNGs, no transparency (`assets/images/ios-icon-*.png`). Splash: `assets/images/splash-icon.png`.
- `scripts/ios-release.sh`: generates the native project, archives, exports a signed `.ipa`, optionally uploads it.

## What only you can do

### 1. Apple Developer Program (one time)
1. Enroll at developer.apple.com/programs (US$99 a year, individual or organisation). Approval can take a day or two.
2. Your keychain currently holds only "Apple Development" certificates. Distribution needs the paid program; Xcode creates the "Apple Distribution" certificate for you in step 4.
3. Note your 10-character **Team ID** (developer.apple.com > Membership details).

### 2. Create the app in App Store Connect
1. appstoreconnect.apple.com > Apps > **+** > New App. Platform iOS, name `Finora`, primary language, bundle ID `com.ahadjeyemby.finora` (register it first under Certificates, Identifiers & Profiles > Identifiers if it is not in the list), SKU anything unique (`finora-ios`).
2. If the name is taken, pick another there; the on-device name stays `Finora` (`app.json` `name`).

### 3. Sign in to Xcode
Xcode > Settings > Accounts > add the Apple ID that is in the paid program.

### 4. Build and export the .ipa
```bash
APPLE_TEAM_ID=YOURTEAMID scripts/ios-release.sh
```
The script runs `expo prebuild --clean`, `xcodebuild archive` (Release) and `-exportArchive` with automatic signing. The `.ipa` lands in `build/ios/`.

Before you run it, make sure `.env` has the production `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`: they are baked into the bundle at build time. The anon key is meant to be public; your data is protected by row level security.

Prefer clicking? `bunx expo prebuild --platform ios`, then `xed ios`, set Team under Signing & Capabilities, Product > Archive > Distribute App > App Store Connect.

### 5. Upload
- **Transporter** (Mac App Store, free): sign in, drag in `build/ios/*.ipa`, Deliver. Or
- `APPLE_ID=you@example.com APPLE_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx APPLE_TEAM_ID=... scripts/ios-release.sh --upload` (app-specific password from appleid.apple.com > Sign-In and Security).

Processing takes 10 to 15 minutes; Apple emails you if the privacy manifest misses a reason.

### 6. TestFlight first (recommended)
App Store Connect > your app > TestFlight. Internal testers (up to 100, no review) can install in minutes. Check sign-in, camera, photo and PDF import, report export and sharing on a real iPhone.

### 7. Fill in the store page
App Store Connect > the app > the 1.0 version. Use `docs/app-store-listing.md` for the copy. You must provide:
- **Screenshots**: iPhone 6.9-inch, 2 to 10 images, exactly 1320x2868 or 1290x2796, PNG/JPG, no transparency. The app runs on iPad (`supportsTablet` is true, all four orientations), so App Store Connect also asks for iPad 13-inch shots: 2 to 10 images, 2064x2752 or 2048x2732 in portrait (2752x2064 or 2732x2048 in landscape). Take them on the iPad Pro 13-inch simulator (`xcrun simctl io <udid> screenshot`). iPhones stay portrait-only; Android follows the device's rotation.
- **Privacy policy URL** (required). Draft text is in `docs/app-store-listing.md`; host it anywhere public.
- **App Privacy** questionnaire (the nutrition label). Answers in `docs/app-store-listing.md`.
- **Age rating** questionnaire, **category** (Finance), **copyright**, **support URL**, contact details.
- **App Review information**: the app needs sign-in, so give the reviewer a demo email and password for a Supabase user that holds only fictional data, plus the notes in the listing doc. Without it the review is rejected.
- Select the uploaded build, then **Submit for Review**. Review usually takes 1 to 2 days.

### 8. Next releases
Raise `ios.buildNumber` for every upload (and `version` for every public release), then run the script again.

## Things that can bite
- The app is a personal tool tied to your own Supabase project. If strangers cannot sign up, App Review may question the app's purpose; the review notes and demo account address that. If it is only for you and a few people, ship it through TestFlight (up to 10,000 external testers after a light beta review) and skip the public listing.
- Finance apps get closer review. Make clear the app does not move money or give investment advice.
- Never put real statements, tokens or `.env` in the demo account or screenshots.
