E-VIEJO THESIS FRONTEND — SEPARATED RESIDENT + ADMIN PORTALS
Barangay Guadalupe Viejo, Makati City

PORTALS
1. Resident Portal: resident submits and tracks requests, views Digital Barangay ID, requests Physical Barangay ID, checks cash payment instructions, announcements, profile/security. Incident Reports are NOT included here.
2. Admin Portal: barangay staff view resident requests, review/approve/reject them, prepare documents/IDs, mark Ready for Pickup, confirm the resident claim and mark Completed, record cash payments, manage residents, announcements, reports, audit logs, users/roles, and Incident Reports.

DEMO LOGIN
Resident: open auth/login.html and use any values in the password login demo.
Admin: open auth/admin-login.html
Admin username: admin
Admin password: admin123

REQUEST WORKFLOW
Resident submits request -> Pending -> Admin reviews -> Approved/Rejected -> Admin processes -> Ready for Pickup -> Resident claims at Barangay Hall -> Admin confirms claim -> Completed.

The current build uses localStorage for a frontend-only demo so resident and admin pages can demonstrate shared request status changes in the same browser. A real thesis deployment still needs a backend/database, secure authentication/roles, server-side validation, document generation, QR scanning, and audit controls.


----- Use Feature Branches ------
Instead of everyone committing directly to main, each member works on their own branch. You will never get a push rejection on your own branch.

For your collaborator (or you):
Create and switch to a new branch:
bash


git checkout -b kurt-updates
Commit and push whenever you want:
bash


git add .
git commit -m "Updated index.html"
git push -u origin kurt-updates
Merge into main:
Go to GitHub and click Compare & pull request (or click Merge).
Once merged into main, everyone just runs git pull origin main to get the latest code.


RULES NATIN FOR THIS MGA MANGGI KO
RULE #1: ALWAYS ASK EVERYONE IF MAG PUPUSH KA NG PR MO PARA UPDATED KAMI DAPAT BEFORE MAG PUSH BAKA MAMAYA MAWALA SASAPAKIN KO
RULE #2: ALWAYS DOUBLE CHECK SA ASSETS IF MAY MAIIWAN OR WALA
RULE #3: NO COMPLIANCE WILL BE TERMINATED (YES TANGINAMO TATANGGALIN KITA) HANGGANG 3 LANG PAG LUMAGPAS I EEVAL KO NA FOR TERMINATIONS AS PER DOC LEA I HAVE AUTHORITY TO KICK SOMEONE ON THE GROUP AND PROVIDE THEM NA WE ALL GROUPMATES AGREE ON THAT.
RULE #4: WAG KUPAL PAG SINABI KONG MEETING, MEETING TAPOS TANGINA.
