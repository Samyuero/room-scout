# Assets Directory

This directory contains static assets used by the Room Scout application.

## Required Images

For the application to work correctly, you may need to add the following images:

1. **placeholder.jpg** - Used when no image is available for a dorm listing
   - Recommended size: 400x300px
   - Format: JPG or PNG
   - Place in: `assets/`

2. **map-marker.png** - Custom marker for dorm locations on the map
   - Recommended size: 50x50px
   - Format: PNG with transparency
   - Place in: `assets/`

3. **Team member photos** (optional) - For the About Us page
   - Four photos of team members
   - Recommended size: 200x200px
   - Format: JPG or PNG
   - Place in: `assets/` and reference in `app/(tabs)/about-us.tsx`

## Existing Assets

The following assets are already included:
- App icons and splash screen images
- Tab navigation icons (home, explore, etc.)
- Logo and branding images

## Image Optimization

For best performance:
- Compress images before adding
- Use appropriate dimensions (don't use large images for small displays)
- Consider using WebP format for better compression (though RN may require additional setup)