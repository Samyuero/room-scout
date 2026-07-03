# Room Scout - Dorm Finder Application
## Project Summary

This document provides an overview of the Room Scout application, a React Native Expo app for finding dormitories and apartments near universities.

## 🎯 Application Overview

Room Scout is a comprehensive dormitory and apartment finding application built with:
- **React Native + Expo** for cross-platform mobile development
- **Supabase** as the backend (PostgreSQL database, authentication, storage)
- **Expo Router** for file-based navigation
- **React Native Maps** for interactive property viewing

## 🏗️ What We've Built

### Core Features Implemented
1. **User Authentication**
   - Email/password registration and login via Supabase Auth
   - Profile management with extended user metadata

2. **Property Listings**
   - Browse available dorms/apartments with images, pricing, and details
   - Property cards showing essential information at a glance
   - Detailed property views with comprehensive information

3. **Search & Discovery**
   - Text-based search by property name/address
   - Advanced filtering by price range, gender policy, utilities, amenities
   - Map-based visualization of available properties
   - Location-aware browsing (shows nearby properties)

4. **Property Management (for Owners)**
   - Add new property listings with detailed information
   - Upload multiple property images
   - Toggle availability status
   - Mark properties as featured for promotion

5. **User Engagement**
   - Review and rating system for properties
   - Favorite/bookmark system (basic implementation)
   - User profiles with personal information

6. **Administrative Features**
   - Basic admin dashboard for monitoring
   - Support/ticket system for user assistance
   - Role-based access control (regular users vs. admins)

### Technical Implementation
- **State Management**: React hooks (useState, useEffect, useContext)
- **Data Fetching**: Direct Supabase client calls with loading/error states
- **Navigation**: Expo Router with tab-based and stack navigation patterns
- **Authentication**: Supabase Auth with protected routes
- **Real-time Updates**: Supabase subscriptions for live data updates
- **Image Handling**: Supabase Storage integration (partially implemented)
- **Caching**: Custom cache service for API responses
- **Error Handling**: Global error boundary and component-level error handling
- **Loading States**: Skeleton loaders, spinners, and placeholder content
- **Accessibility**: Basic accessibility considerations (touch targets, contrast)

## 📁 Project Structure

```
room-scout/
├── app/                    # Expo routing (pages)
│   ├── (tabs)/            # Tab navigation
│   │   ├── home.tsx       # Home screen - property browsing
│   │   ├── search.tsx     # Search and filters
│   │   ├── map.tsx        # Map view
│   │   ├── profile.tsx    # User profile
│   │   └── settings.tsx   # Settings
│   ├── (auth)/            # Authentication screens
│   │   ├── sign-in.tsx    # Sign in screen
│   │   └── sign-up.tsx    # Sign up screen
│   ├── _layout.tsx        # Root layout with Supabase providers
│   └── [dormId].tsx       # Dorm details screen
├── src/                   
│   ├── components/        # Reusable components (loaders, error boundaries)
│   ├── hooks/             # Custom hooks (authentication, etc.)
│   ├── services/          # Service configurations (Supabase client)
│   ├── styles/            # CSS stylesheets for web views
│   └── utils/             # Utility functions (image upload, caching)
├── assets/                # Static assets (images, icons)
├── supabase/              # Database schema and migrations
├── app.json               # Expo configuration
├── package.json           # Dependencies and scripts
└── README.md              # This file
```

## 🔧 Setup Instructions

### Prerequisites
- Node.js (v14 or higher)
- npm or yarn
- Expo CLI (optional, for development)
- A Supabase account

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd room-scout
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env
   ```
   Then edit `.env` to add your Supabase credentials:
   ```
   EXPO_PUBLIC_SUPABASE_URL=your_supabase_project_url
   EXPO_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
   ```

4. **Set up the database**
   - Go to your Supabase project dashboard
   - Navigate to the SQL Editor
   - Copy and paste the contents of `supabase/schema.sql`
   - Run the query to create tables, policies, and enable real-time subscriptions

### Running the Application

#### Development Mode
```bash
# Start the Expo development server
npm start

# Then choose:
# - Press "a" to run on Android emulator
# - Press "i" to run on iOS simulator
# - Press "w" to run on web browser
# - Or scan the QR code with Expo Go app on your physical device
```

#### Building for Production
```bash
# Install EAS CLI if not already installed
npm install -g eas-cli

# Login to Expo
eas login

# Build the APK for Android
eas build -p android --profile preview

# Build the iOS app (requires Mac with Xcode)
eas build -p ios --profile preview
```

## 🧪 Verification

To verify your setup is correct:
```bash
npm run verify-setup
```

This script checks for:
- Required environment variables
- Installed dependencies
- Necessary source files
- Database schema file

## 🛠️ Development Scripts

| Script | Description |
|--------|-------------|
| `npm start` | Start the Expo development server |
| `npm run android` | Start dev server and open Android emulator |
| `npm run ios` | Start dev server and open iOS simulator |
| `npm run web` | Start dev server and open in web browser |
| `npm run reset-project` | Reset project to clean state (reinstalls dependencies) |
| `npm run setup-supabase` | Interactive setup for Supabase credentials |
| `npm run verify-setup` | Verify development environment is correct |
| `npm run lint` | Run ESLint for code quality |

## 📱 Platform Support

- **Android**: ✅ Fully supported (minimum Android 5.0)
- **iOS**: ✅ Fully supported (minimum iOS 13)
- **Web**: ✅ Supported via Expo Web

## 🔐 Security Features

- Row Level Security (RLS) enforced on all database tables
- Input validation and sanitization on all user inputs
- Secure password handling (via Supabase Auth, never stored plaintext)
- Protected API endpoints requiring authentication
- Environment variables for sensitive configuration
- No sensitive data stored in client-side code or local storage

## ⚡ Performance Optimizations

- Lazy loading of images as they come into view
- Pagination for large lists (implemented in API service layer)
- Efficient database queries with proper indexing
- Client-side caching of frequently accessed data
- Optimized re-renders using React.memo and useCallback hooks
- Batch database operations where applicable
- Minimal bundle size through code splitting and asset optimization

## 🧩 Extensibility

The application is designed to be easily extensible:

1. **Adding New Features**: 
   - Create new screen directories under `app/`
   - Use existing service patterns for data access
   - Follow established component patterns

2. **Customizing Appearance**:
   - Modify styles in component files or create a theme system
   - Update assets in the `assets/` directory
   - Adjust colors and spacing in individual components

3. **Backend Enhancements**:
   - Extend the Supabase schema in `supabase/schema.sql`
   - Add new Edge Functions for server-side logic
   - Implement additional real-time subscriptions

4. **Third-party Integrations**:
   - Add analytics services (Firebase, Mixpanel, etc.)
   - Integrate payment processors for premium features
   - Add social login options (Google, Facebook, Apple)

## 📝 Known Limitations & Future Work

### Current Limitations
- Image upload functionality needs completion (currently uses URL placeholders)
- Advanced search filters could be enhanced with more options
- Real-time updates could be expanded to more data types
- Offline functionality is planned but not implemented
- Advanced analytics and reporting features are pending

### Planned Enhancements
- [ ] Complete image upload to Supabase Storage
- [ ] Advanced search with saved searches
- [ ] Push notifications for new matches and messages
- [ ] Offline caching with synchronization
- [ ] User verification and trust badges
- [ ] Premium features and subscription system
- [ ] Administrator analytics dashboard
- [ ] Multi-language support (i18n)
- [ ] Accessibility improvements (screen reader support, etc.)

## 👥 Development Team

This application was developed as a capstone project by:

**Team SNAP** - Students from UCLM (University of Castilla-La Mancha)
- [Member 1 Name] - Project Management & Full-stack Development
- [Member 2 Name] - Frontend Development & UI/UX Design
- [Member 3 Name] - Backend Development & Database Design
- [Member 4 Name] - Quality Assurance & Documentation

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgements

- Expo team for the amazing development framework
- Supabase team for the awesome backend-as-a-service
- React Native community for various libraries and components
- UCLM for providing the academic environment for this project
- Open source contributors whose work made this project possible

---

**Ready to start finding your perfect home? Run `npm start` and begin your journey with Room Scout!**