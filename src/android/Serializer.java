package com.zenkit.cordova.openwith;

import android.content.ClipData;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;
import android.util.Base64;
import java.io.IOException;
import java.io.InputStream;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

// Handle serialization of Android objects ready to be sent to javascript.
class Serializer {

    // Convert an intent to JSON.
    // This actually only exports stuff necessary to see file content
    // (streams or clip data) sent with the intent.
    // If none are specified, null is return.
    public static JSONObject convertIntentToJSON(
            final ContentResolver contentResolver,
            final Intent intent)
            throws JSONException {
        JSONArray items = null;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
            items = Serializer.itemsFromClipData(contentResolver, intent.getClipData());
        }
        if (items == null || items.length() == 0) {
            items = Serializer.itemsFromExtras(contentResolver, intent);
        }
        if (items == null || items.length() == 0) {
            items = Serializer.itemsFromData(contentResolver, intent.getData());
        }
        if (items == null) {
            return null;
        }

        final JSONObject action = new JSONObject();
        action.put("action", Serializer.translateAction(intent.getAction()));
        action.put("exit", Serializer.readExitOnSent(intent.getExtras()));
        action.put("items", items);
        return action;
    }

    public static String translateAction(final String action) {
        if (Intent.ACTION_SEND.equals(action) || Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            return "SEND";
        } else if (Intent.ACTION_VIEW.equals(action)) {
            return "VIEW";
        }
        return action;
    }

    // Read the value of "exit_on_sent" in the intent's extra.
    // Defaults to false.
    public static boolean readExitOnSent(final Bundle extras) {
        if (extras == null) {
            return false;
        }
        return extras.getBoolean("exit_on_sent", false);
    }

    // Extract the list of items from clip data (if available).
    // Defaults to null.
    public static JSONArray itemsFromClipData(
            final ContentResolver contentResolver,
            final ClipData clipData)
            throws JSONException {
        if (clipData == null) {
            return null;
        }

        final int clipItemCount = clipData.getItemCount();
        JSONArray items = new JSONArray();
        for (int i = 0; i < clipItemCount; i++) {
            ClipData.Item item = clipData.getItemAt(i);
            Uri uri = item.getUri();
            String text = (String) item.getText();
            JSONObject json = buildJSONItem(contentResolver, uri, text);
            if (json != null) {
                items.put(json);
            }
        }

        return items;
    }

    // Extract the list of items from the intent's extra stream.
    // See Intent.EXTRA_STREAM for details.
    public static JSONArray itemsFromExtras(
            final ContentResolver contentResolver,
            final Intent intent)
            throws JSONException {
        if (intent == null) {
            return null;
        }

        String type = intent.getType();
        if ("text/plain".equals(type)) {
            String text = intent.getStringExtra(Intent.EXTRA_TEXT);
            if (text != null) {
                final JSONObject item = Serializer.buildJSONItem(contentResolver, null, text);
                if (item != null) {
                    JSONArray items = new JSONArray();
                    items.put(item);
                    return items;
                }
            }
        }

        Bundle extras = intent.getExtras();
        if (extras == null) {
            return null;
        }

        Uri uri = (Uri) extras.get(Intent.EXTRA_STREAM);
        final JSONObject item = Serializer.buildJSONItem(contentResolver, uri, null);
        if (item == null) {
            return null;
        }

        JSONArray items = new JSONArray();
        items.put(item);
        return items;
    }

    // Extract the list of items from the intent's getData
    // See Intent.ACTION_VIEW for details.
    public static JSONArray itemsFromData(
            final ContentResolver contentResolver,
            final Uri uri)
            throws JSONException {
        if (uri == null) {
            return null;
        }

        final JSONObject item = Serializer.buildJSONItem(contentResolver, uri, null);
        if (item == null) {
            return null;
        }

        JSONArray items = new JSONArray();
        items.put(item);
        return items;
    }

    // Convert an Uri and Text to JSON object.
    // Object will include:
    //     "text" content, if applicable.
    //     "uri"  of the file, if applicable.
    //     "type" of the file, if applicable.
    //     "path" to the file, if applicable.
    //     "name" of the file, if applicable.
    public static JSONObject buildJSONItem(
            final ContentResolver contentResolver,
            final Uri uri,
            final String text)
            throws JSONException {
        if (uri == null && text == null) {
            return null;
        }

        final JSONObject json = new JSONObject();
        json.put("text", text);
        json.put("uri", uri);
        if (uri != null) {
            json.put("type", contentResolver.getType(uri));
            json.put("path", Serializer.getRealPathFromURI(contentResolver, uri));
            json.put("name", Serializer.getNameFromUri(contentResolver, uri));
        }
        return json;
    }

    // Convert the Uri to the direct file system path of the image file.
    public static String getRealPathFromURI(ContentResolver contentResolver, Uri uri) {
        String[] projection = { MediaStore.Images.Media.DATA };
        Cursor metaCursor = contentResolver.query(uri, projection, null, null, null);

        if (metaCursor != null) {
            try {
                if (metaCursor.moveToFirst()) {
                    return metaCursor.getString(0);
                }
            } finally {
                metaCursor.close();
            }
        }

        return null;
    }

    public static String getNameFromUri (ContentResolver contentResolver, Uri uri) {
        String[] projection = { MediaStore.MediaColumns.DISPLAY_NAME };
        Cursor metaCursor = contentResolver.query(uri, projection, null, null, null);

        if (metaCursor != null) {
            try {
                if (metaCursor.moveToFirst()) {
                    return metaCursor.getString(0);
                }
            } finally {
                metaCursor.close();
            }
        }

        return null;
    }
}
