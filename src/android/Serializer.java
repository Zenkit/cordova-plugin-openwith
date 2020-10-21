package com.zenkit.cordova.openwith;

import android.content.ClipData;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;
import android.text.TextUtils;
import android.webkit.MimeTypeMap;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;

// Handle serialization of Android objects ready to be sent to javascript.
class Serializer {
    private static Boolean isEmpty(JSONArray array) {
        return array == null || array.length() < 1;
    }

    private static String queryColumnFromUri(Uri uri, ContentResolver resolver, String column) {
        String[] projection = {column};
        Cursor cursor = resolver.query(uri, projection, null, null, null);
        if (cursor != null) {
            try {
                if (cursor.moveToFirst()) {
                    int index = cursor.getColumnIndex(column);
                    return cursor.getString(index);
                }
            } finally {
                cursor.close();
            }
        }
        return null;
    }
    private static String getFileNameFromUri(Uri uri, ContentResolver resolver) {
        return queryColumnFromUri(uri, resolver, MediaStore.MediaColumns.DISPLAY_NAME);
    }
    private static String getFileTypeFromUri(Uri uri, ContentResolver resolver) {
        String mimetype = queryColumnFromUri(uri, resolver, MediaStore.MediaColumns.MIME_TYPE);
        if (mimetype != null) {
            return mimetype;
        }
        if (uri.getScheme() == ContentResolver.SCHEME_CONTENT) {
            return resolver.getType(uri);
        }
        String extension = MimeTypeMap.getFileExtensionFromUrl(uri.toString());
        return MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension.toLowerCase());
    }

    private static JSONObject buildTextItem(String text) throws JSONException {
        if (text == null) {
            return null;
        }

        JSONObject item = new JSONObject();
        item.put("text", text);
        return item;
    }

    private static JSONObject buildFileItem(Uri uri, ContentResolver resolver) throws JSONException {
        if (uri == null) {
            return null;
        }

        JSONObject item = new JSONObject();
        item.put("uri", uri);
        item.put("type", getFileTypeFromUri(uri, resolver));
        item.put("name", getFileNameFromUri(uri, resolver));
        return item;
    }

    // Extract the list of items from the intent's extra.
    public static JSONArray itemsFromExtras(Intent intent, ContentResolver resolver) throws JSONException {
        JSONArray items = new JSONArray();

        ArrayList<String> texts = new ArrayList<>();
        if (intent.hasExtra(Intent.EXTRA_SUBJECT)) {
            String subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
            if (subject.isEmpty() == false) {
                texts.add(subject);
            }
        }
        if (intent.hasExtra(Intent.EXTRA_TEXT)) {
            String text = intent.getStringExtra(Intent.EXTRA_TEXT);
            if (text.isEmpty() == false) {
                texts.add(text);
            }
        }
        if (texts.isEmpty() == false) {
            final JSONObject item = buildTextItem(TextUtils.join("\n", texts));
            if (item != null) {
                items.put(item);
            }
        }

        ArrayList<Uri> uris = new ArrayList<>();
        if (intent.hasExtra(Intent.EXTRA_STREAM)) {
            if (Intent.ACTION_SEND_MULTIPLE.equals(intent.getAction())) {
               uris = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            } else {
                Uri uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
                if (uri != null) {
                    uris.add(uri);
                }
            }
        }
        if (uris.isEmpty() == false) {
            for (Uri uri : uris) {
                final JSONObject item = buildFileItem(uri, resolver);
                if (item != null) {
                    items.put(item);
                }
            }
        }

        return items;
    }

    // Extract the list of items from clip data (if available).
    public static JSONArray itemsFromClipData(Intent intent, ContentResolver resolver) throws JSONException {

        ClipData clipData = intent.getClipData();
        if (clipData == null) {
            return null;
        }

        JSONArray items = new JSONArray();
        for (int i = 0; i < clipData.getItemCount(); i++) {
            ClipData.Item clipItem = clipData.getItemAt(i);
            String text = (String) clipItem.getText();

            JSONObject textItem = buildTextItem(text);
            if (textItem != null) {
                items.put(textItem);
                continue;
            }

            Uri uri = clipItem.getUri();
            JSONObject fileItem = buildFileItem(uri, resolver);
            if (fileItem != null) {
                items.put(fileItem);
            }
        }

        return items;
    }

    // Extract the list of items from the intent's getData
    // See Intent.ACTION_VIEW for details.
    public static JSONArray itemsFromData(Intent intent, ContentResolver resolver) throws JSONException {

        Uri uri = intent.getData();
        JSONArray items = new JSONArray();
        JSONObject item = buildFileItem(uri, resolver);
        if (item != null) {
            items.put(item);
        }

        return items;
    }


    private static String translateAction(Intent intent) {
        String action = intent.getAction();
        if (Intent.ACTION_SEND.equals(action) || Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            return "SEND";
        } else if (Intent.ACTION_VIEW.equals(action)) {
            return "VIEW";
        }
        return action;
    }

    // Read the value of "exit_on_sent" in the intent's extra.
    // Defaults to false.
    private static boolean shouldExitOnSent(Intent intent) {
        Bundle extras = intent.getExtras();
        if (extras == null) {
            return false;
        }
        return extras.getBoolean("exit_on_sent", false);
    }

    // Convert an intent to JSON.
    // 1. Check the extras this will handle most cases
    // 2. If the extras are empty try to get the clip data
    // 3. If there are still no items we fallback to data
    public static JSONObject convertIntentToJSON(Intent intent, ContentResolver resolver) throws JSONException {
        if (intent == null) {
            return null;
        }

        JSONArray items = itemsFromExtras(intent, resolver);

        Boolean isClipDataSupported = Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT;
        if (isClipDataSupported && isEmpty(items)) {
            items = itemsFromClipData(intent, resolver);
        }

        if (isEmpty(items)) {
            items = itemsFromData(intent, resolver);
        }

        if (isEmpty(items)) {
            return null;
        }

        JSONObject json = new JSONObject();
        json.put("action", translateAction(intent));
        json.put("exit", shouldExitOnSent(intent));
        json.put("items", items);
        return json;
    }
}
