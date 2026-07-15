#!/bin/bash
set -e

# Visual formatting helper
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${CYAN}===================================================${NC}"
echo -e "${CYAN}      DEPLOYOWL APPLICATION DEPLOYMENT SCRIPT      ${NC}"
echo -e "${CYAN}===================================================${NC}"

# Step 1: Verification
echo -e "${BLUE}[1/3] Verifying file structure and code syntax...${NC}"

if [ ! -d "dist" ] || [ ! -f "dist/index.html" ] || [ ! -f "dist/style.css" ] || [ ! -f "dist/app.js" ]; then
  echo -e "${RED}Error: Dist files are missing! Ensure dist/index.html, dist/style.css, and dist/app.js exist.${NC}"
  exit 1
fi

if [ ! -d "api" ] || [ ! -f "api/index.js" ]; then
  echo -e "${RED}Error: api/index.js is missing!${NC}"
  exit 1
fi

# Dry run JavaScript check for API
if command -v node &> /dev/null; then
  node -c api/index.js
  echo -e "${GREEN}✓ API syntax check passed.${NC}"
else
  echo -e "${YELLOW}⚠ Warning: Node.js not installed, skipping API syntax check.${NC}"
fi

# Step 2: Archiving
echo -e "${BLUE}[2/3] Archiving calendar application...${NC}"
tar -czf bundle.tar.gz api dist
echo -e "${GREEN}✓ Generated bundle.tar.gz successfully.${NC}"

# Step 3: Deployment request
echo -e "${BLUE}[3/3] Uploading and deploying to DeployWeb...${NC}"
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST https://api.deployowl.com/v1/deployweb/instant \
  -H "Authorization: Bearer owl_b9c18842fba54fa88688932ab670ea5f" \
  -F "file=@bundle.tar.gz" \
  -F "projectId=04115d36-fa98-4629-abcf-219e48adb2a4" \
  -F "triggeredBy=cli")

# Extract status code and body
HTTP_STATUS=$(echo "$RESPONSE" | tail -n 1)
HTTP_BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_STATUS" -eq 200 ] || [ "$HTTP_STATUS" -eq 201 ] || [ "$HTTP_STATUS" -eq 202 ]; then
  echo -e "${GREEN}✓ Deployment request complete with status ${HTTP_STATUS}!${NC}"
  echo -e "${CYAN}Response: ${HTTP_BODY}${NC}"
else
  echo -e "${RED}Error: Deployment failed with status ${HTTP_STATUS}!${NC}"
  echo -e "${RED}Response: ${HTTP_BODY}${NC}"
  exit 1
fi

echo -e "${GREEN}===================================================${NC}"
echo -e "${GREEN}             DEPLOYMENT SUCCESSFUL!                ${NC}"
echo -e "${GREEN}===================================================${NC}"
