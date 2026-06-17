import boto3
import json
import urllib.request
import urllib.error
import datetime
import os

dynamodb = boto3.resource("dynamodb", region_name="us-east-1")
logs_table = dynamodb.Table("gutpacer-logs")
settings_table = dynamodb.Table("gutpacer-settings")

LINE_CHANNEL_ACCESS_TOKEN = os.environ["LINE_CHANNEL_ACCESS_TOKEN"]
LINE_USER_ID = os.environ["LINE_USER_ID"]
APP_URL = "https://veai.jp/gutpacer/"


def get_jst_date(offset_days=0):
    now = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
    target = now + datetime.timedelta(days=offset_days)
    return target.strftime("%Y-%m-%d")


def get_log(date_str):
    try:
        resp = logs_table.get_item(Key={"fullDate": date_str})
        return resp.get("Item")
    except Exception as e:
        print(f"DynamoDB get_item failed for {date_str}: {e}")
        return None


def send_line_message(messages):
    payload = json.dumps({"to": LINE_USER_ID, "messages": messages}).encode("utf-8")
    req = urllib.request.Request(
        "https://api.line.me/v2/bot/message/push",
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": "Bearer " + LINE_CHANNEL_ACCESS_TOKEN,
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req) as res:
            print("LINE API response:", res.status, res.read().decode())
    except urllib.error.HTTPError as e:
        print("LINE API error:", e.code, e.read().decode())
        raise


def build_app_button(label, color):
    return {
        "type": "button",
        "action": {"type": "uri", "label": label, "uri": APP_URL},
        "style": "primary",
        "color": color,
    }


def build_reminder_message():
    """昨日1日だけ記録がない場合の催促通知"""
    return {
        "type": "flex",
        "altText": "GutPacer: 昨日の記録がまだありません",
        "contents": {
            "type": "bubble",
            "header": {
                "type": "box",
                "layout": "vertical",
                "backgroundColor": "#f59e0b",
                "paddingAll": "16px",
                "contents": [
                    {
                        "type": "text",
                        "text": "📝 記録の入力をお願いします",
                        "weight": "bold",
                        "color": "#ffffff",
                        "size": "md",
                        "wrap": True,
                    }
                ],
            },
            "body": {
                "type": "box",
                "layout": "vertical",
                "paddingAll": "16px",
                "contents": [
                    {
                        "type": "text",
                        "text": "昨日の記録がまだありません。アプリから記録を入力してください。",
                        "wrap": True,
                        "size": "sm",
                        "color": "#374151",
                    }
                ],
            },
            "footer": {
                "type": "box",
                "layout": "vertical",
                "paddingAll": "12px",
                "contents": [build_app_button("アプリを開く", "#4f46e5")],
            },
        },
    }


def build_warning_message(missing_days):
    """2日以上記録がない場合の警告通知"""
    return {
        "type": "flex",
        "altText": "GutPacer: " + str(missing_days) + "日間記録がありません",
        "contents": {
            "type": "bubble",
            "header": {
                "type": "box",
                "layout": "vertical",
                "backgroundColor": "#ef4444",
                "paddingAll": "16px",
                "contents": [
                    {
                        "type": "text",
                        "text": "⚠️ " + str(missing_days) + "日間記録がありません",
                        "weight": "bold",
                        "color": "#ffffff",
                        "size": "md",
                        "wrap": True,
                    }
                ],
            },
            "body": {
                "type": "box",
                "layout": "vertical",
                "paddingAll": "16px",
                "contents": [
                    {
                        "type": "text",
                        "text": str(missing_days) + "日間記録がありません。体調はどうですか？",
                        "wrap": True,
                        "size": "sm",
                        "color": "#374151",
                    }
                ],
            },
            "footer": {
                "type": "box",
                "layout": "vertical",
                "paddingAll": "12px",
                "contents": [build_app_button("アプリを開く", "#ef4444")],
            },
        },
    }


def lambda_handler(event, context):
    # 1. 居住環境チェック（施設なら通知しない）
    location = "home"
    try:
        resp = settings_table.get_item(Key={"settingKey": "location"})
        location = resp.get("Item", {}).get("value", "home")
    except Exception as e:
        print(f"Settings fetch failed, assuming home: {e}")

    if location == "facility":
        print("Location is facility - skipping notification")
        return {"statusCode": 200, "body": "Skipped (facility)"}

    # 2. 直近2日間の記録を取得（在宅の場合のみ）
    yesterday = get_jst_date(-1)
    day_before = get_jst_date(-2)

    yesterday_log = get_log(yesterday)
    day_before_log = get_log(day_before)

    # 3. 判定ロジック
    if yesterday_log is not None:
        # 昨日の記録あり → 通知不要
        print("Record found for yesterday - no notification needed")
        return {"statusCode": 200, "body": "No notification needed"}

    if day_before_log is None:
        # 昨日も一昨日も記録なし → 2日以上の警告
        # さらに遡って連続日数を計算
        missing_days = 2
        while True:
            check_date = get_jst_date(-(missing_days + 1))
            if get_log(check_date) is None:
                missing_days += 1
                if missing_days >= 7:
                    break
            else:
                break

        print(f"{missing_days} days without records - sending warning")
        send_line_message([build_warning_message(missing_days)])
        return {"statusCode": 200, "body": f"Sent: {missing_days}-day warning"}

    # 昨日だけ記録なし → 通常の催促
    print("No record for yesterday only - sending reminder")
    send_line_message([build_reminder_message()])
    return {"statusCode": 200, "body": "Sent: reminder"}
