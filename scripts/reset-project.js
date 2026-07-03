#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🔄 Resetting Room Scout project...');

try {
  // Remove node_modules
  if (fs.existsSync('node_modules')) {
    console.log('🗑️  Removing node_modules...');
    execSync('rm -rf node_modules', { stdio: 'inherit' });
  }

  // Remove package-lock.json
  if (fs.existsSync('package-lock.json')) {
    console.log('🗑️  Removing package-lock.json...');
    execSync('rm -f package-lock.json', { stdio: 'inherit' });
  }

  // Remove .expo directory
  if (fs.existsSync('.expo')) {
    console.log('🗑️  Removing .expo directory...');
    execSync('rm -rf .expo', { stdio: 'inherit' });
  }

  // Reinstall dependencies
  console.log('📦 Installing dependencies...');
  execSync('npm install', { stdio: 'inherit' });

  console.log('\n✅ Project reset complete!');
  console.log('🚀 You can now run:');
  console.log('   npm start');
  console.log('');
  console.log('📝 Remember to:');
  console.log('   1. Copy .env.example to .env');
  console.log('   2. Add your Supabase credentials');
  console.log('   3. Set up your Supabase database using supabase/schema.sql');

} catch (error) {
  console.error('❌ Error during reset:', error.message);
  process.exit(1);
}