# RoomScout — Use Case Specifications

Each use case below includes a **small use case diagram** and a **specification table**, following the same format as your reference.

---

## 1. LOGIN PROCESS

```
                    ┌─────────────────────────────────────────────┐
                    │                                             │
   ○               │                    ┌──────────────────┐     │
  /|\  ─────────── │── Load Login Form  │  <<extends>>     │     │
  / \              │        │           │  ┌─────────────┐ │     │
 Dorm Seeker       │        │<<include>>├──▶Access Homepage│     │
                   │        ▼           │  └─────────────┘ │     │
   ○               │  ┌───────────────┐ │                  │     │
  /|\  ─────────── │──│  Validate     │─┤                  │     │
  / \              │  │  Credentials  │ │  <<extends>>     │     │
 Dorm Owner        │  └───────────────┘ │  ┌─────────────┐ │     │
                   │                    ├──▶Display Error │ │     │
   ○               │                    │  └─────────────┘ │     │
  /|\  ─────────── │                    │                  │     │
  / \              │                    └──────────────────┘     │
 Admin             │                                             │
                    └─────────────────────────────────────────────┘
                                Figure 1: Login Process
```

| Field | Details |
|-------|---------|
| **Use Case Name** | Login Process |
| **Actor** | Dorm Seeker, Dorm Owner, Admin |
| **Brief Description** | When a user logs into the application, the system will validate whether the entered credentials exist in the system. If valid, the user is redirected to the home page based on their role. Otherwise, an error is displayed. |
| **Trigger** | The user opens the application. |
| **Pre-Conditions** | An account must already be registered in the database. |
| **Post Conditions** | The user will be able to access the application after logging in. |

| **Flow of Activities** | |
|---|---|
| **Actor(s)** | **Application** |
| 1. Open the application. | |
| | 2. Display the login form (email & password). |
| 3. Enter credentials. | |
| 4. Click the "Sign In" button. | |
| | 5. Validate the input credentials by checking the database. |
| | 5.1. If the credentials are valid, proceed to the home page based on the user's role (Seeker → Home, Owner → Home, Admin → Home). |
| | 5.2. Else, display the error message. |

---

## 2. REGISTRATION PROCESS

```
                    ┌─────────────────────────────────────────────┐
                    │                                             │
   ○               │                    ┌──────────────────┐     │
  /|\  ─────────── │── Load Sign-Up     │  <<extends>>     │     │
  / \              │    Form            │  ┌─────────────┐ │     │
 Dorm Seeker       │        │           ├──▶Redirect to  │ │     │
                   │        │<<include>>│  │Setup Username│ │     │
   ○               │        ▼           │  └─────────────┘ │     │
  /|\  ─────────── │  ┌───────────────┐ │                  │     │
  / \              │  │  Validate     │─┤  <<extends>>     │     │
 Dorm Owner        │  │  Credentials  │ │  ┌─────────────┐ │     │
                   │  └───────┬───────┘ ├──▶Display Error │ │     │
                   │          │         │  └─────────────┘ │     │
                   │          │<<include>>                  │     │
                   │          ▼         │                  │     │
                   │  ┌───────────────┐ │                  │     │
                   │  │  Select Role  │ │                  │     │
                   │  └───────────────┘ │                  │     │
                   │                    └──────────────────┘     │
                    └─────────────────────────────────────────────┘
                            Figure 2: Registration Process
```

| Field | Details |
|-------|---------|
| **Use Case Name** | Registration Process |
| **Actor** | Dorm Seeker, Dorm Owner |
| **Brief Description** | When a user wants to create an account, the system will display a registration form where they can enter their credentials and choose a role (Dorm Seeker or Dorm Owner). |
| **Trigger** | The user clicks the "Get Started" button. |
| **Pre-Conditions** | The user wants to use the application. |
| **Post Conditions** | The user will be able to access the application after registering. |

| **Flow of Activities** | |
|---|---|
| **Actor(s)** | **Application** |
| 1. Click the "Get Started" button. | |
| | 2. Display the registration form. |
| 3. Enter email and password. | |
| 4. Select role: "Student / Renter" or "Dorm Owner". | |
| 5. Click the "Sign Up" button. | |
| | 6. Validate the input credentials by checking the database. |
| | 6.1. If the credentials are not yet registered, save to database, create the user profile in the appropriate role table, and redirect to the Setup Username screen. |
| | 6.2. Else, display an error message (e.g., "Email already registered"). |

---

## 3. MANAGE PROFILE

```
                    ┌─────────────────────────────────────────────┐
                    │                                             │
   ○               │                    ┌──────────────────┐     │
  /|\  ─────────── │── View Profile     │  <<extends>>     │     │
  / \              │    Screen          │  ┌─────────────┐ │     │
 Dorm Seeker       │        │           ├──▶Edit Profile │ │     │
                   │        │<<include>>│  └─────────────┘ │     │
   ○               │        ▼           │                  │     │
  /|\  ─────────── │  ┌───────────────┐ │  <<extends>>     │     │
  / \              │  │  Load User    │─┤  ┌─────────────┐ │     │
 Dorm Owner        │  │  Data         │ ├──▶View Rental  │ │     │
                   │  └───────────────┘ │  │History       │ │     │
   ○               │                    │  └─────────────┘ │     │
  /|\  ─────────── │                    │                  │     │
  / \              │                    └──────────────────┘     │
 Admin             │                                             │
                    └─────────────────────────────────────────────┘
                            Figure 3: Manage Profile
```

| Field | Details |
|-------|---------|
| **Use Case Name** | Manage Profile |
| **Actor** | Dorm Seeker, Dorm Owner, Admin |
| **Brief Description** | The user can view and edit their profile information including full name, username, and avatar. Dorm Seekers can also view their rental history and set behavior preferences. |
| **Trigger** | The user navigates to the Profile tab. |
| **Pre-Conditions** | The user must be logged in. |
| **Post Conditions** | The profile information is updated in the database. |

| **Flow of Activities** | |
|---|---|
| **Actor(s)** | **Application** |
| 1. Navigate to the Profile tab. | |
| | 2. Fetch user data from the appropriate role table (renters, owners, or admins). |
| | 3. Display the profile screen with user information and role badge. |
| 4. Click "Edit Profile". | |
| | 5. Display editable fields (full name, username, avatar URL). |
| 6. Modify the desired fields. | |
| 7. Click "Save". | |
| | 8. Update the user record in the database and display a success message. |

---

## 4. BROWSE DORM LISTINGS

```
                    ┌─────────────────────────────────────────────┐
                    │                                             │
   ○               │                    ┌──────────────────┐     │
  /|\  ─────────── │── Browse Dorm      │  <<extends>>     │     │
  / \              │    Listings         │  ┌─────────────┐ │     │
 Dorm Seeker       │        │           ├──▶Search Dorms │ │     │
                   │        │<<include>>│  └─────────────┘ │     │
                   │        ▼           │                  │     │
                   │  ┌───────────────┐ │  <<extends>>     │     │
                   │  │  Load Dorm    │─┤  ┌─────────────┐ │     │
                   │  │  Data from DB │ ├──▶Filter Dorms │ │     │
                   │  └───────────────┘ │  └─────────────┘ │     │
                   │                    │                  │     │
                   │                    │  <<extends>>     │     │
                   │                    │  ┌─────────────┐ │     │
                   │                    ├──▶View on Map  │ │     │
                   │                    │  └─────────────┘ │     │
                   │                    └──────────────────┘     │
                    └─────────────────────────────────────────────┘
                        Figure 4: Browse Dorm Listings
```

| Field | Details |
|-------|---------|
| **Use Case Name** | Browse Dorm Listings |
| **Actor** | Dorm Seeker |
| **Brief Description** | The Dorm Seeker can browse all available dormitory listings. They may optionally search by keyword, apply filters (price, gender, pet-friendly, parking, LGU certified), or view listings on a map. |
| **Trigger** | The user navigates to the Home or Search tab. |
| **Pre-Conditions** | Dorm listings must exist in the database. |
| **Post Conditions** | The user sees a list of dormitories matching their criteria. |

| **Flow of Activities** | |
|---|---|
| **Actor(s)** | **Application** |
| 1. Navigate to Home or Search tab. | |
| | 2. Fetch all available dorm listings from the database. |
| | 3. Display dorm cards (name, price, address, photo). |
| 4. *(Optional)* Enter a search keyword. | |
| | 5. Filter results by name or address match and update the list. |
| 6. *(Optional)* Apply filters (price range, gender, amenities, pet-friendly, parking, LGU certified). | |
| | 7. Re-query the database with filters and update the list. |
| 8. *(Optional)* Switch to Map view. | |
| | 9. Display dorm locations as pins on the map. |

---

## 5. VIEW DORM DETAILS

```
                    ┌─────────────────────────────────────────────┐
                    │                                             │
   ○               │                     <<extends>>             │
  /|\  ─────────── │── View Dorm  ─ ─ ─ ┌─────────────────┐     │
  / \              │    Details          │Submit Rental Req│     │
 Dorm Seeker       │        │      ─ ─ ─└─────────────────┘     │
                   │        │<<include>>                         │
                   │        ▼            <<extends>>             │
                   │  ┌───────────────┐  ┌─────────────────┐     │
                   │  │Load Dorm Info │──│Write Review     │     │
                   │  │& Reviews     │  └─────────────────┘     │
                   │  └───────────────┘                          │
                   │                     <<extends>>             │
                   │               ─ ─ ─ ┌─────────────────┐     │
                   │                     │Get Map Directions│     │
                   │               ─ ─ ─ └─────────────────┘     │
                    └─────────────────────────────────────────────┘
                        Figure 5: View Dorm Details
```

| Field | Details |
|-------|---------|
| **Use Case Name** | View Dorm Details |
| **Actor** | Dorm Seeker |
| **Brief Description** | The user taps a dorm listing to see full details: price, address, amenities, utilities, curfew, pet-friendly status, parking info, contract rules, photos, reviews, and map location. From this screen, they can optionally submit a rental request, write a review, or get directions. |
| **Trigger** | The user taps a dorm card from the listings. |
| **Pre-Conditions** | The user must be browsing dorm listings. |
| **Post Conditions** | The user has viewed the full details of a dorm. |

| **Flow of Activities** | |
|---|---|
| **Actor(s)** | **Application** |
| 1. Tap on a dorm card. | |
| | 2. Fetch the dorm's full details, reviews, and rental request status from the database. |
| | 3. Display the details screen (photos, price, amenities, utilities, parking, pet-friendly, gender policy, curfew, contract rules, reviews, map). |
| 4. *(Optional)* Tap "Request to Rent/Reserve". | |
| | 5. Open the booking modal (see Use Case 6). |
| 6. *(Optional)* Tap "Add Review". | |
| | 7. Open the review modal (see Use Case 7). |
| 8. *(Optional)* Tap "Get Directions". | |
| | 9. Open the device's map app with the dorm's coordinates. |

---

## 6. SUBMIT RENTAL/RESERVATION REQUEST

```
                    ┌─────────────────────────────────────────────┐
                    │                                             │
   ○               │                                             │
  /|\  ─────────── │── Submit Booking                             │
  / \              │    Request                                   │
 Dorm Seeker       │        │                                     │
                   │        │<<include>>  <<include>>             │
                   │        ├────────────┬───────────┐            │
                   │        ▼            ▼           ▼            │
                   │  ┌───────────┐┌──────────┐┌──────────┐      │
                   │  │Upload     ││Review QR ││Upload    │      │
                   │  │Gov ID     ││& Contract││Payment   │      │
                   │  └───────────┘└──────────┘└──────────┘      │
                   │                                             │
                   │        ─ ─ ─ ─ ─ <<extends>> ─ ─            │
                   │                                             │
                   │              ┌───────────────┐              │
                   │              │Notify Owner   │              │
                   │              └───────────────┘              │
                    └─────────────────────────────────────────────┘
                    Figure 6: Submit Rental/Reservation Request
```

| Field | Details |
|-------|---------|
| **Use Case Name** | Submit Rental/Reservation Request |
| **Actor** | Dorm Seeker |
| **Brief Description** | The seeker submits a request (rental or reservation) by providing a valid government ID. Once accepted, they receive the owner's QR and contract. They then upload payment proof and agree to the contract. |
| **Trigger** | The user taps "Request to Rent" or "Reserve" on a dorm details page. |
| **Pre-Conditions** | The user must be logged in as a Dorm Seeker. The dorm must be available. |
| **Post Conditions** | A request record is created. Once payment is uploaded, it awaits owner confirmation. |

| **Flow of Activities** | |
|---|---|
| **Actor(s)** | **Application** |
| 1. Tap "Request to Rent" or "Reserve". | |
| | 2. Display the initial request modal. |
| 3. Enter the Valid ID document URL. | |
| 4. Tap "Submit Request". | |
| | 5. Status becomes 'pending'. Notify owner. |
| | *--- Owner Accepts (See UC 12) ---* |
| | 6. Notify seeker that request is accepted. Show QR, required amount, and contract. |
| 7. Scan QR, complete payment, review contract. | |
| 8. Enter Payment Proof URL and agree to terms. | |
| | 9. Update status to 'payment_submitted'. Notify owner for final confirmation. |

---

## 7. WRITE REVIEW & RATING

```
                    ┌─────────────────────────────────────────────┐
                    │                                             │
   ○               │                     <<extends>>             │
  /|\  ─────────── │── Write Review ─ ─ ┌─────────────────┐     │
  / \              │        │           │Display Success  │     │
 Dorm Seeker       │        │<<include>>└─────────────────┘     │
                   │        ▼                                    │
                   │  ┌───────────────┐  <<extends>>             │
                   │  │Validate Rating│──┌─────────────────┐     │
                   │  │& Comment      │  │Display Error    │     │
                   │  └───────────────┘  └─────────────────┘     │
                    └─────────────────────────────────────────────┘
                        Figure 7: Write Review & Rating
```

| Field | Details |
|-------|---------|
| **Use Case Name** | Write Review & Rating |
| **Actor** | Dorm Seeker |
| **Brief Description** | The renter can submit a 1–5 star rating and a text comment for any dorm they have visited or rented. |
| **Trigger** | The user taps "Add Review" on the dorm details page. |
| **Pre-Conditions** | The user must be logged in as a Dorm Seeker. |
| **Post Conditions** | A review record is saved in the dorm_reviews table. |

| **Flow of Activities** | |
|---|---|
| **Actor(s)** | **Application** |
| 1. Tap "Add Review" on the dorm details page. | |
| | 2. Display the review modal with star rating selector and comment box. |
| 3. Select a rating (1–5 stars). | |
| 4. Write a comment. | |
| 5. Tap "Submit". | |
| | 6. Insert the review into the database. Display success message and refresh the reviews list. |

---

## 8. USE AI CHATBOT
*(Similar to your pasted content)*

## 9. VIEW PRICE & LOCATION ANALYTICS
*(Similar to your pasted content)*

## 10. SUBMIT OWNER VERIFICATION
*(Similar to your pasted content)*

## 11. CREATE DORM LISTING
*(Similar to your pasted content)*

---

## 12. PROCESS RENTAL/RESERVATION REQUEST

```
                    ┌─────────────────────────────────────────────┐
                    │                                             │
   ○               │                     <<extends>>             │
  /|\  ─────────── │── Process Booking─ ┌─────────────────┐     │
  / \              │    Request          │Accept & Send QR │     │
 Dorm Owner        │        │           └─────────────────┘     │
                   │        │<<include>>                         │
                   │        ▼            <<extends>>             │
                   │  ┌───────────────┐  ┌─────────────────┐     │
                   │  │Review Seeker's│  │Verify Payment & │     │
                   │  │ID & Payment   │──│Confirm Booking  │     │
                   │  └───────────────┘  └─────────────────┘     │
                   │                     <<extends>>             │
                   │               ─ ─ ─ ┌─────────────────┐     │
                   │                     │Decline Request  │     │
                   │                     └─────────────────┘     │
                    └─────────────────────────────────────────────┘
                Figure 12: Process Rental/Reservation Request
```

| Field | Details |
|-------|---------|
| **Use Case Name** | Process Rental/Reservation Request |
| **Actor** | Dorm Owner |
| **Brief Description** | The owner reviews pending requests, accepts by providing QR/Contract/Amount, and later verifies the seeker's payment proof to fully confirm the booking. |
| **Trigger** | The owner navigates to the Owner Dashboard → Requests tab. |
| **Pre-Conditions** | A pending request exists. |
| **Post Conditions** | The request is fully approved, and the dorm becomes unavailable. |

| **Flow of Activities** | |
|---|---|
| **Actor(s)** | **Application** |
| 1. Navigate to Requests tab. | |
| | 2. Display pending requests. |
| 3. Review seeker's Gov ID. Tap "Accept". | |
| | 4. Prompt owner for required amount, contract details, and GCash QR. |
| 5. Submit acceptance details. | |
| | 6. Status updates to awaiting payment. Notify seeker. |
| | *--- Seeker Pays (See UC 6) ---* |
| 7. Review the uploaded Payment Proof. | |
| 8. Tap "Confirm Booking". | |
| | 9. Update status to 'approved'. Mark dorm unavailable. |

---

## 13. MANAGE TENANTS
*(Similar to your pasted content)*

## 14. REVIEW OWNER VERIFICATIONS (Admin)
*(Similar to your pasted content)*

## 15. MODERATE DORM LISTINGS (Admin)
*(Similar to your pasted content)*

## 16. VIEW NOTIFICATIONS
*(Similar to your pasted content)*

## 17. SUBMIT SUPPORT TICKET
*(Similar to your pasted content)*

---

## 18. CANCEL RESERVATION & PROCESS REFUND

```
                    ┌─────────────────────────────────────────────┐
                    │                                             │
   ○               │                     <<extends>>             │
  /|\  ─────────── │── Cancel Booking ─ ┌─────────────────┐     │
  / \              │        │           │Submit GCash Info│     │
 Dorm Seeker       │        │<<include>>└─────────────────┘     │
                   │        ▼                                    │
                   │  ┌───────────────┐  <<extends>>             │
                   │  │Notify Owner   │──┌─────────────────┐     │
                   │  │To Refund      │  │Send Refund &    │     │
                   │  └───────┬───────┘  │Upload Proof     │     │
                   │          │          └──────────┬──────┘     │
   ○               │          │<<extends>>          │<<extends>> │
  /|\  ─────────── │          ▼                     ▼            │
  / \              │  ┌───────────────┐  ┌─────────────────┐     │
 Dorm Owner        │  │Confirm Refund │  │Admin Oversees   │     │
                   │  │Received       │  │Disputes         │     │
                   │  └───────────────┘  └─────────────────┘     │
                    └─────────────────────────────────────────────┘
                Figure 18: Cancel Reservation & Process Refund
```

| Field | Details |
|-------|---------|
| **Use Case Name** | Cancel Reservation & Process Refund |
| **Actor** | Dorm Seeker, Dorm Owner, Admin |
| **Brief Description** | A seeker cancels an approved reservation and requests a refund. The owner deducts a 10% fee and sends the refund, uploading proof. The seeker confirms receipt. Admins oversee disputes. |
| **Trigger** | The seeker taps "Cancel Reservation" on an approved reservation. |
| **Pre-Conditions** | An approved reservation exists. |
| **Post Conditions** | The refund is completed, and the dorm becomes available again. |

| **Flow of Activities** | |
|---|---|
| **Actor(s)** | **Application** |
| 1. (Seeker) Tap "Cancel Reservation". | |
| | 2. Prompt for cancellation reason and GCash details. |
| 3. (Seeker) Submit cancellation. | |
| | 4. Status updates to 'refund_requested'. Dorm becomes available. Notify owner. |
| 5. (Owner) Review refund request. Send GCash refund (minus 10%). | |
| 6. (Owner) Upload Refund Proof URL and tap "Mark Refund Sent". | |
| | 7. Status updates to 'refund_sent'. Notify seeker. |
| 8. (Seeker) Check GCash. Tap "Confirm Refund Received". | |
| | 9. Status updates to 'refund_completed'. |
| *(Optional)* (Seeker) Tap "Dispute Refund". | |
| | 10. Status updates to 'refund_disputed' for Admin review. |

