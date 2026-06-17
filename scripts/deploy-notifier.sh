#!/bin/bash
# GutPacer notifier Lambda deployment script
# Run this in AWS CloudShell (us-east-1)
#
# Usage:
#   export LINE_CHANNEL_ACCESS_TOKEN="your_token"
#   export LINE_USER_ID="your_user_id"
#   bash deploy-notifier.sh

set -e

REGION="us-east-1"
FUNCTION_NAME="gutpacer-notifier"
ROLE_NAME="gutpacer-notifier-role"
RULE_NAME="gutpacer-daily-8am-jst"

if [ -z "$LINE_CHANNEL_ACCESS_TOKEN" ] || [ -z "$LINE_USER_ID" ]; then
    echo "ERROR: Set LINE_CHANNEL_ACCESS_TOKEN and LINE_USER_ID before running."
    echo "  export LINE_CHANNEL_ACCESS_TOKEN=\"...\""
    echo "  export LINE_USER_ID=\"...\""
    exit 1
fi

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "Account: $ACCOUNT_ID, Region: $REGION"

# ── 1. IAM Role ─────────────────────────────────────────────────────────────
echo "Creating IAM role..."
aws iam create-role \
    --role-name "$ROLE_NAME" \
    --assume-role-policy-document '{
        "Version": "2012-10-17",
        "Statement": [{
            "Effect": "Allow",
            "Principal": {"Service": "lambda.amazonaws.com"},
            "Action": "sts:AssumeRole"
        }]
    }' 2>/dev/null || echo "Role already exists, skipping."

aws iam attach-role-policy \
    --role-name "$ROLE_NAME" \
    --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole 2>/dev/null || true

aws iam put-role-policy \
    --role-name "$ROLE_NAME" \
    --policy-name DynamoDBReadPolicy \
    --policy-document "{
        \"Version\": \"2012-10-17\",
        \"Statement\": [{
            \"Effect\": \"Allow\",
            \"Action\": [\"dynamodb:GetItem\", \"dynamodb:Scan\"],
            \"Resource\": [
                \"arn:aws:dynamodb:${REGION}:${ACCOUNT_ID}:table/gutpacer-logs\",
                \"arn:aws:dynamodb:${REGION}:${ACCOUNT_ID}:table/gutpacer-settings\"
            ]
        }]
    }"

echo "Waiting 10s for IAM role to propagate..."
sleep 10

# ── 2. Lambda function zip ───────────────────────────────────────────────────
echo "Packaging Lambda code..."
TMPDIR=$(mktemp -d)
cp "$(dirname "$0")/../backend/notifier/index.mjs" "$TMPDIR/index.mjs"
cd "$TMPDIR" && zip -q function.zip index.mjs && cd -

ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/${ROLE_NAME}"
ENV_VARS="Variables={LINE_CHANNEL_ACCESS_TOKEN=${LINE_CHANNEL_ACCESS_TOKEN},LINE_USER_ID=${LINE_USER_ID}}"

# ── 3. Create or update Lambda function ─────────────────────────────────────
if aws lambda get-function --function-name "$FUNCTION_NAME" --region "$REGION" > /dev/null 2>&1; then
    echo "Updating existing Lambda function..."
    aws lambda update-function-code \
        --function-name "$FUNCTION_NAME" \
        --zip-file "fileb://${TMPDIR}/function.zip" \
        --region "$REGION" > /dev/null
    aws lambda update-function-configuration \
        --function-name "$FUNCTION_NAME" \
        --environment "$ENV_VARS" \
        --region "$REGION" > /dev/null
else
    echo "Creating Lambda function..."
    aws lambda create-function \
        --function-name "$FUNCTION_NAME" \
        --runtime nodejs24.x \
        --role "$ROLE_ARN" \
        --handler index.handler \
        --zip-file "fileb://${TMPDIR}/function.zip" \
        --environment "$ENV_VARS" \
        --timeout 30 \
        --region "$REGION" > /dev/null
fi

FUNCTION_ARN="arn:aws:lambda:${REGION}:${ACCOUNT_ID}:function:${FUNCTION_NAME}"
echo "Lambda ready: $FUNCTION_ARN"

# ── 4. EventBridge scheduled rule (23:00 UTC = 8:00 JST) ────────────────────
echo "Creating EventBridge rule..."
aws events put-rule \
    --name "$RULE_NAME" \
    --schedule-expression "cron(0 23 * * ? *)" \
    --state ENABLED \
    --region "$REGION" > /dev/null

# Allow EventBridge to invoke Lambda
aws lambda add-permission \
    --function-name "$FUNCTION_NAME" \
    --statement-id EventBridgeInvoke \
    --action lambda:InvokeFunction \
    --principal events.amazonaws.com \
    --source-arn "arn:aws:events:${REGION}:${ACCOUNT_ID}:rule/${RULE_NAME}" \
    --region "$REGION" 2>/dev/null || echo "Permission already exists, skipping."

# Attach Lambda as EventBridge target
aws events put-targets \
    --rule "$RULE_NAME" \
    --region "$REGION" \
    --targets "[{\"Id\": \"${FUNCTION_NAME}\", \"Arn\": \"${FUNCTION_ARN}\"}]" > /dev/null

echo ""
echo "Done! To test manually:"
echo "  aws lambda invoke --function-name $FUNCTION_NAME --region $REGION /tmp/out.json && cat /tmp/out.json"
