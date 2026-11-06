#!/usr/bin/env node

const { execFileSync } = require('node:child_process');
const fs = require('fs');


console.log('🔍 Verifying RoomScout setup...');

const errors = [];
const warnings = [];
const info = [];

// Check for .env file
if (!fs.existsSync('.env')) {
  errors.push('❌ .env file not found. Please create one from .env.example');
} else {
  info.push('✅ .env file found');

  // Validate actual values, not just whether names occur in the file.
  try {
    execFileSync(process.execPath, ['scripts/validate-build-env.js'], { stdio: 'inherit' });
  } catch { errors.push('Invalid Supabase environment. Run npm run verify-build for details.'); }

  // Check for required environment variables
  const envContent = fs.readFileSync('.env', 'utf8');

  if (!envContent.includes('EXPO_PUBLIC_SUPABASE_URL=')) {
    errors.push('❌ EXPO_PUBLIC_SUPABASE_URL not set in .env');
  } else {
    info.push('✅ EXPO_PUBLIC_SUPABASE_URL found in .env');
  }

  if (!envContent.includes('EXPO_PUBLIC_SUPABASE_ANON_KEY=') && !envContent.includes('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=')) {
    errors.push('❌ EXPO_PUBLIC_SUPABASE_ANON_KEY not set in .env');
  } else {
    info.push('✅ EXPO_PUBLIC_SUPABASE_ANON_KEY found in .env');
  }
}

// Check for node_modules
if (!fs.existsSync('node_modules')) {
  errors.push('❌ node_modules not found. Please run: npm install');
} else {
  info.push('✅ node_modules directory found');
}

// Check for package-lock.json
if (!fs.existsSync('package-lock.json')) {
  warnings.push('⚠️  package-lock.json not found. Consider running: npm install');
} else {
  info.push('✅ package-lock.json found');
}

// Check for key source files
const requiredFiles = [
  'app/_layout.tsx',
  'app/(tabs)/_layout.tsx',
  'app/(auth)/sign-in.tsx',
  'app/(auth)/sign-up.tsx',
  'app/(tabs)/home.tsx',
  'app/(tabs)/search.tsx',
  'app/(tabs)/map.tsx',
  'app/(tabs)/profile.tsx',
  'app/(tabs)/settings.tsx',
  'src/lib/supabase.ts'
];

const missingFiles = requiredFiles.filter(file => !fs.existsSync(file));
if (missingFiles.length > 0) {
  errors.push(`❌ Missing ${missingFiles.length} required file(s):`);
  missingFiles.forEach(file => {
    errors.push(`   - ${file}`);
  });
} else {
  info.push('✅ All required source files found');
}

// Check Supabase schema
if (!fs.existsSync('supabase/schema_v2.sql')) {
  warnings.push('⚠️  supabase/schema_v2.sql not found');
} else {
  info.push('✅ Supabase schema file found');
}

// Display results
console.log('\n' + '='.repeat(50));
console.log('📋 VERIFICATION RESULTS');
console.log('='.repeat(50));

if (info.length > 0) {
  console.log('\n✅ PASSED CHECKS:');
  info.forEach(item => console.log(`  ${item}`));
}

if (warnings.length > 0) {
  console.log('\n⚠️  WARNINGS:');
  warnings.forEach(item => console.log(`  ${item}`));
}

if (errors.length > 0) {
  console.log('\n❌ ERRORS:');
  errors.forEach(item => console.log(`  ${item}`));

  console.log('\n🔧 To fix these issues:');
  console.log('   1. Make sure you\'re in the project root directory');
  console.log('   2. Run: npm install');
  console.log('   3. Copy .env.example to .env and add your Supabase credentials');
  console.log('   4. Set up your Supabase database using supabase/schema_v2.sql');
  process.exit(1);
} else {
  console.log('\n🎉 All checks passed! Local checks passed. Run npm run verify-survey before distributing a test APK.');
  console.log('\n🚀 To start the development server:');
  console.log('   npm start');
  console.log('\n📱 Then choose:');
  console.log('   - Press "a" for Android emulator');
  console.log('   - Press "i" for iOS simulator');
  console.log('   - Press "w" for web browser');
  console.log('   - Or scan the QR code with Expo Go app');
  process.exit(0);
}
