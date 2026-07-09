# **Product Requirements Document: Social Manager Thing (MVP v1.0)**

## **1\. Introduction and Goals**

### **1.1 Project Overview**

**Social Manager Thing** is a modern, high-performance content scheduling and team management application for Instagram Business Accounts. It is designed to provide a secure, collaborative environment for agencies and small businesses to manage their social media output efficiently, bypassing traditional server bottlenecks by leveraging a serverless architecture.

### **1.2 Core Objectives**

* **Enable Secure Publishing:** Allow users to schedule and publish Image, Video, and Carousel content to Instagram via the Graph API.  
* **Support Collaboration:** Implement multi-user access (Teams) with role-based access control (ACL).  
* **Establish Monetization:** Integrate usage-based subscription tiers via Stripe to maximize revenue and match user needs.  
* **Leverage Modern Stack:** Utilize the speed and scalability of React, Cloudflare Workers, and Xata.

  ## **2\. Target Audience and Users**

The primary user is a small-to-medium business or marketing agency seeking a reliable, high-uptime tool for Instagram management.

### **2.1 User Roles**

| Role | Responsibility | App Permissions (Enforced by Worker) |
| ----- | ----- | ----- |
| **Admin (Primary User)** | Manages subscriptions, team members, connects/disconnects Meta account, and has full content control. | Full R/W access to all data, Team management, Stripe integration. |
| **Editor** | Responsible for daily content creation and publishing. | R/W access to Posts (Create, Schedule, Publish, Delete). Cannot manage team/billing. |
| **Viewer** | Observes content pipeline and performance metrics. | Read-Only access to Posts and Dashboard. |

## **3\. Scope of MVP Features (v1.0)**

### **3.1 Authentication & Authorization**

* **User Login:** Users must authenticate using **Google OAuth** or **Facebook Login**.  
* **Meta Connection:** A single Admin user must securely connect their Instagram Business Account via **Meta/Facebook OAuth** to obtain the necessary Long-Lived Access Token (LLAT).  
* **Secure Token Storage:** The LLAT must be stored in the **Xata `Teams` table**, never exposed to the client.

  ### **3.2 Content Management (Core Feature)**

* **Scheduling:** Users (Admin/Editor) can submit a new post by providing:  
  * `Caption` (text)  
  * `Media URL` (publicly accessible link to Image/Video)  
  * `Media Type` (Image, Video, Carousel \- *Carousel implementation is deferred but planned*).  
* **Publishing:**  
  * User clicks "Publish Now" on a scheduled post.  
  * **CF Worker Process:** The worker uses the stored LLAT to execute the two-step Instagram Graph API flow (Create Media Container, then Publish Media).  
* **Status Tracking:** Posts must have a visible status (`SCHEDULED`, `PUBLISHED`, `FAILED`).  
* **Content Limits:** Creation must be subject to the user's daily subscription tier limit.

  ### **3.3 Team Management**

* **Invitation:** Admins can invite team members by email and assign a role (`Editor`, `Viewer`).  
* **Team Data:** Team member association and roles must be persisted in the **Xata `TeamMembers` table**.  
* **ACL Enforcement:** All API endpoints (`/api/posts`, `/api/instagram/*`, `/api/team/*`) must be strictly protected by the CF Worker using the user's role.

  ### **3.4 Subscription & Billing**

* **Tier Enforcement:** The CF Worker must track and strictly enforce the daily post limit for each tier.  
* **Stripe Checkout Integration:** Redirect users from the dashboard to Stripe Checkout for upgrades.  
* **Stripe Webhooks:** The CF Worker must handle Stripe webhooks (e.g., `checkout.session.completed`, `customer.subscription.updated`) to automatically update the user's **Xata `Teams` table** with the correct `current_tier` and `subscription_status`.

  ## **4\. Monetization and Usage Tiers**

| Tier Name | Monthly Cost | Daily Post Limit (Per Team) | Access Level | Description |
| ----- | ----- | ----- | ----- | ----- |
| **Free** | **$0** | **1 post per day** | Content creation limited to 1 post/day. Standard team roles. | Designed for evaluation and very small usage. |
| **Standard** | **$100** | **10 posts per day** | Ideal for small businesses or heavy individual users. | Provides a significant increase in daily capacity. |
| **Pro** | **$500** | **Meta Rate Limits** | Unlimited daily posts (capped only by Meta's API limits). | Designed for high-volume agencies and publishers. |

  ## **5\. Technical Architecture & Data (CF Worker, Xata)**

  ### **5.1 Technology Stack**

* **Frontend:** React (Vite) \+ Tailwind CSS (Single File JSX)  
* **Backend & API Gateway:** Cloudflare Workers (Handling Authentication, ACL, Stripe Webhooks, API proxying)  
* **Database:** Xata (Managed PostgreSQL for durable storage and scalability)  
* **Billing:** Stripe  
* **Third-Party API:** Meta/Instagram Graph API

  ### **5.2 Key Xata Schema Requirements (Conceptual Tables)**

| Table | Field Name | Type | Purpose |
| ----- | ----- | ----- | ----- |
| **Teams** | `id` | `string` | Unique Team ID (Primary Key) |
|  | `owner_id` | `link` to `Users` | ID of the Admin/Owner |
|  | `current_tier` | `string` | (`FREE`, `STANDARD`, `PRO`) |
|  | `posts_created_today` | `integer` | Counter for daily limit enforcement |
|  | `usage_reset_date` | `datetime` | When the `posts_created_today` counter was last reset |
|  | **`ig_llat`** | `string` | **Encrypted** Long-Lived Access Token |
|  | `stripe_customer_id` | `string` | Stripe Customer ID |
|  | `stripe_subscription_id` | `string` | Active Stripe Subscription ID |
| **Users** | `id` | `string` | Unique User ID (from Google/FB OAuth) |
|  | `email` | `string` | User email address |
|  | `name` | `string` | User display name |
| **TeamMembers** | `id` | `string` | Unique ID |
|  | `team_id` | `link` to `Teams` | The team this member belongs to |
|  | `user_id` | `link` to `Users` | The user ID of the member |
|  | `role` | `string` | (`Admin`, `Editor`, `Viewer`) |
| **Posts** | `id` | `string` | Unique Post ID |
|  | `team_id` | `link` to `Teams` | The team that owns the post |
|  | `creator_id` | `link` to `Users` | The team member who created the post |
|  | `caption` | `string` | Content caption |
|  | `media_url` | `string` | Public URL of the media file |
|  | `status` | `string` | (`SCHEDULED`, `PUBLISHED`, `FAILED`) |
|  | `scheduled_at` | `datetime` | Target publishing time |

  ### **5.3 Cloudflare Worker Endpoints (Proxy & Logic)**

| Endpoint | Method | Purpose | ACL/Limit Check |
| ----- | ----- | ----- | ----- |
| `/api/auth/google` | `GET` | Initiates Google OAuth redirect. | None (Public) |
| `/api/auth/facebook` | `GET` | Initiates Meta OAuth redirect. | None (Public) |
| `/api/posts` | `GET` | Fetches all team posts. | Must be authenticated member of the team. |
| `/api/posts` | **`POST`** | Creates a new scheduled post (Saves to Xata). | **Strict: Must be Admin/Editor AND enforce daily post limit based on tier.** |
| `/api/instagram/publish` | **`POST`** | Executes the 2-step Meta Graph API publish flow. | **Strict: Must be Admin/Editor.** |
| `/api/stripe/checkout` | `POST` | Creates and redirects to a Stripe Checkout Session. | Must be Admin. |
| `/api/stripe-webhook` | `POST` | **Receives webhook from Stripe to update Xata.** | **Strict: Must verify Stripe signature.** |
| `/api/team/members` | `POST`/`DELETE` | Manages team member invitations. | **Strict: Must be Admin.** |

  ## **6\. Future Scope (V1.1+)**

* **Carousel Support:** Full support for submitting multiple media URLs for carousel posts.  
* **Media Uploads:** Allow direct image/video upload (instead of public URL) using Cloudflare R2 or similar storage before passing to Meta's servers.  
* **Analytics:** Fetch and display post metrics (likes, comments, reach) using the Instagram Graph API Insights endpoints.  
* **Scheduling:** Implement a time/date picker for future scheduling instead of "Publish Now."  
* 

