#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

console.log('🚀 Setting up Supabase for Room Scout...');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const askQuestion = (query) => {
  return new Promise((resolve) => {
    rl.question(query, (answer) => {
      resolve(answer.trim());
    });
  });
};

async function main() {
  try {
    // Check if .env exists, if not create from .env.example
    if (!fs.existsSync('.env')) {
      if (fs.existsSync('.env.example')) {
        console.log('📄 Creating .env file from .env.example...');
        fs.copyFileSync('.env.example', '.env');
        console.log('✅ .env created. Please edit it with your Supabase credentials.');
      } else {
        console.log('⚠️  .env.example not found. Creating empty .env file...');
        fs.writeFileSync('.env', '');
        console.log('✅ Empty .env created. Please add your Supabase credentials.');
      }
    }

    // Ask for Supabase credentials
    console.log('\n🔐 Please provide your Supabase project credentials:');
    const supabaseUrl = await askQuestion('  Enter your Supabase project URL: ');
    const supabaseAnonKey = await askQuestion('  Enter your Supabase anon key: ');

    if (supabaseUrl && supabaseAnonKey) {
      // Update .env file
      let envContent = `EXPO_PUBLIC_SUPABASE_URL=${supabaseUrl}\n`;
      envContent += `EXPO_PUBLIC_SUPABASE_ANON_KEY=${supabaseAnonKey}\n`;

      fs.writeFileSync('.env', envContent);
      console.log('\n✅ .env file updated with your Supabase credentials.');
    } else {
      console.log('\n⚠️  Skipping .env update. Please manually add your credentials to .env file.');
    }

    // Provide instructions for setting up the database
    console.log('\n📋 Next steps for database setup:');
    console.log('1. Go to your Supabase project dashboard');
    console.log('2. Navigate to the SQL Editor');
    console.log('3. Copy and paste the contents of supabase/schema.sql');
    console.log('4. Click "Run" to execute the SQL and create tables');
    console.log('5. Enable real-time subscriptions if not already done');
    console.log('   (The SQL in schema.sql should handle this)');

    console.log('\n📝 To verify your setup later, run:');
    console.log('   npm run verify-setup');

    rl.close();
  } catch (error) {
    console.error('❌ Error during setup:', error.message);
    rl.close();
    process.exit(1);
  }
}

main();