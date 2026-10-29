# Security policy

Aurora is an independent project. Security reports are taken seriously and fixed as quickly as possible.

## Supported versions

| Version | Supported |
| --- | --- |
| 1.0.x | Yes |
| Older builds | Best effort only — please update first |

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Use [GitHub's private vulnerability reporting](https://github.com/BannedVariable/BannedVariable.github.io/security/advisories/new). Include:

- the platform and Aurora version (**Settings → About**)
- what the issue lets someone do, and who could be affected
- clear steps to reproduce, with a proof of concept if you have one
- any relevant logs, with tokens, passwords and personal data removed

You will get an acknowledgement as soon as the report is seen. The report will be confirmed as in scope, you will be kept updated on the fix, and you can be credited in the advisory if you would like.

## Scope

In scope:

- the Aurora apps for iPhone, Android, Windows, macOS and Linux
- the sign-in flow and the callback page in `aurora/auth.html`
- this website and its download links
- the update checker and release downloads

Out of scope:

- the availability, legality or quality of music on YouTube, YouTube Music or SoundCloud
- vulnerabilities in those platforms, in iOS or Android, or in third-party signing tools such as SideStore
- issues that require an already-compromised device or an attacker with your unlocked phone
- spam, social engineering and physical access

## What not to do

Do not access other people's data, disrupt the service, or publish details before a fix is available. Test only with your own accounts and devices.

There is no bug bounty. Aurora is free and non-commercial; reports are handled on a best-effort basis.
