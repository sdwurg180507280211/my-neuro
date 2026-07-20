#!/bin/bash
# My Neuro - Automatic Installation Script
# This script installs all dependencies and sets up the environment

set -e

echo "======================================"
echo "  My Neuro - Automatic Installation"
echo "======================================"
echo ""

# Check if Homebrew is installed
if ! command -v brew &> /dev/null; then
    echo "📦 Installing Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
else
    echo "✅ Homebrew already installed"
fi

# Check if direnv is installed
if ! command -v direnv &> /dev/null; then
    echo "📦 Installing direnv..."
    brew install direnv
else
    echo "✅ direnv already installed"
fi

# Add direnv hook to zshrc if not already there
if ! grep -q "direnv hook" ~/.zshrc; then
    echo "🔧 Adding direnv hook to ~/.zshrc..."
    echo 'eval "$(direnv hook zsh)"' >> ~/.zshrc
fi

# Check if conda is available
if ! command -v conda &> /dev/null; then
    echo "⚠️  Conda not found. Please install miniforge first:"
    echo "   https://github.com/conda-forge/miniforge"
    exit 1
else
    echo "✅ Conda detected"
fi

# Create conda environment if it doesn't exist
if ! conda info --envs | grep -q "^my-neuro"; then
    echo "🔧 Creating conda environment 'my-neuro'..."
    conda env create -f environment.yml
else
    echo "✅ Conda environment 'my-neuro' already exists"
fi

# Allow direnv
echo "🔧 Allowing direnv..."
direnv allow

echo ""
echo "📦 Installing Python dependencies..."
source "$(conda info --base)/etc/profile.d/conda.sh"
conda activate my-neuro
pip install -r requirements.txt

echo ""
echo "📦 Installing frontend (Electron) dependencies..."
cd live-2d && npm install && cd ..

echo ""
echo "======================================"
echo "✅ Installation complete!"
echo ""
echo "Next steps:"
echo "1. Restart your terminal or run: source ~/.zshrc"
echo "2. cd into the project directory, direnv will auto-activate my-neuro"
echo "3. Run: python main.py to start"
echo "======================================"
