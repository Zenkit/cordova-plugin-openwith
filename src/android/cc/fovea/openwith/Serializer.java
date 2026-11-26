package cc.fovea.openwith;

import android.content.ClipData;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.os.Parcelable;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.text.TextUtils;
import android.util.Base64;
import android.webkit.MimeTypeMap;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Handle serialization of Android objects ready to be sent to javascript.
 */
class Serializer {

    /** Convert a SEND or SEND_MULTIPLE intent to JSON.
     *
     * Items are read from the extras first (texts and streams), then from the
     * clip data and finally from the intent's data.
     * If no items are found, null is returned.
     */
    public static JSONObject toJSONObject(
            final ContentResolver contentResolver,
            final Intent intent)
            throws JSONException {
        JSONArray items = itemsFromExtras(contentResolver, intent);
        if (items.length() == 0) {
            items = itemsFromClipData(contentResolver, intent.getClipData());
        }
        if (items.length() == 0) {
            items = itemsFromData(contentResolver, intent.getData());
        }
        if (items.length() == 0) {
            return null;
        }
        final JSONObject action = new JSONObject();
        action.put("action", translateAction(intent.getAction()));
        action.put("exit", readExitOnSent(intent.getExtras()));
        action.put("items", items);
        return action;
    }

    public static String translateAction(final String action) {
        if ("android.intent.action.SEND".equals(action) ||
            "android.intent.action.SEND_MULTIPLE".equals(action)) {
            return "SEND";
        } else if ("android.intent.action.VIEW".equals(action)) {
            return "VIEW";
        }
        return action;
    }

    /** Read the value of "exit_on_sent" in the intent's extra.
     *
     * Defaults to false. */
    public static boolean readExitOnSent(final Bundle extras) {
        if (extras == null) {
            return false;
        }
        return extras.getBoolean("exit_on_sent", false);
    }

    /** Extract the list of items from the intent's extras.
     *
     * EXTRA_SUBJECT and EXTRA_TEXT are joined into one text item,
     * every EXTRA_STREAM uri becomes a file item.
     * The extras are read first because e.g. Chrome also puts the shared
     * text into the clip data. */
    @SuppressWarnings("deprecation")
    public static JSONArray itemsFromExtras(
            final ContentResolver contentResolver,
            final Intent intent)
            throws JSONException {
        final JSONArray items = new JSONArray();

        final ArrayList<String> texts = new ArrayList<String>();
        addText(texts, intent.getCharSequenceExtra(Intent.EXTRA_SUBJECT));
        addText(texts, intent.getCharSequenceExtra(Intent.EXTRA_TEXT));
        if (!texts.isEmpty()) {
            items.put(textItem(TextUtils.join("\n", texts)));
        }

        final ArrayList<Parcelable> streams = new ArrayList<Parcelable>();
        if (Intent.ACTION_SEND_MULTIPLE.equals(intent.getAction())) {
            final ArrayList<Parcelable> extras = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (extras != null) {
                streams.addAll(extras);
            }
        } else {
            streams.add(intent.getParcelableExtra(Intent.EXTRA_STREAM));
        }
        for (final Parcelable stream : streams) {
            if (stream instanceof Uri) {
                items.put(toJSONObject(contentResolver, (Uri) stream));
            }
        }

        return items;
    }

    private static void addText(final ArrayList<String> texts, final CharSequence text) {
        if (text != null && text.length() > 0) {
            texts.add(text.toString());
        }
    }

    /** Extract the list of items from clip data (if available). */
    public static JSONArray itemsFromClipData(
            final ContentResolver contentResolver,
            final ClipData clipData)
            throws JSONException {
        final JSONArray items = new JSONArray();
        if (clipData == null) {
            return items;
        }
        for (int i = 0; i < clipData.getItemCount(); i++) {
            final ClipData.Item clipItem = clipData.getItemAt(i);
            final CharSequence text = clipItem.getText();
            final Uri uri = clipItem.getUri();
            if (text != null && text.length() > 0) {
                items.put(textItem(text.toString()));
            } else if (uri != null) {
                items.put(toJSONObject(contentResolver, uri));
            }
        }
        return items;
    }

    /** Extract the list of items from the intent's getData
     *
     * See Intent.ACTION_VIEW for details. */
    public static JSONArray itemsFromData(
            final ContentResolver contentResolver,
            final Uri uri)
            throws JSONException {
        final JSONArray items = new JSONArray();
        if (uri != null) {
            items.put(toJSONObject(contentResolver, uri));
        }
        return items;
    }

    private static JSONObject textItem(final String text) throws JSONException {
        final JSONObject json = new JSONObject();
        json.put("text", text);
        return json;
    }

    /** Convert an Uri to JSON object.
     *
     * Object will include:
     *    "uri" itself;
     *    "type" the mime type of the file;
     *    "name" the display name of the file.
     */
    public static JSONObject toJSONObject(
            final ContentResolver contentResolver,
            final Uri uri)
            throws JSONException {
        final JSONObject json = new JSONObject();
        json.put("uri", uri.toString());
        json.put("type", getMimeType(contentResolver, uri));
        json.put("name", getDisplayName(contentResolver, uri));
        return json;
    }

    private static String getDisplayName(final ContentResolver contentResolver, final Uri uri) {
        if (ContentResolver.SCHEME_CONTENT.equals(uri.getScheme())) {
            return queryColumn(contentResolver, uri, OpenableColumns.DISPLAY_NAME);
        }
        return uri.getLastPathSegment();
    }

    private static String getMimeType(final ContentResolver contentResolver, final Uri uri) {
        if (ContentResolver.SCHEME_CONTENT.equals(uri.getScheme())) {
            // NOTE: Prefer the type MediaStore detected for the file
            // over the type the providing app declared.
            final String type = queryColumn(contentResolver, uri, MediaStore.MediaColumns.MIME_TYPE);
            if (type != null) {
                return type;
            }
            try {
                final String resolverType = contentResolver.getType(uri);
                if (resolverType != null) {
                    return resolverType;
                }
            } catch (RuntimeException e) {
                // Fall back to the file extension
            }
        }
        final String extension = MimeTypeMap.getFileExtensionFromUrl(uri.toString());
        if (extension == null || extension.isEmpty()) {
            return null;
        }
        return MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension.toLowerCase(Locale.ROOT));
    }

    /** Query a single string column of a content uri. Defaults to null.
     *
     * Providers don't have to support every column (e.g. FileProvider only
     * knows the OpenableColumns) and some throw for unknown ones. */
    private static String queryColumn(
            final ContentResolver contentResolver,
            final Uri uri,
            final String column) {
        Cursor cursor = null;
        try {
            cursor = contentResolver.query(uri, new String[] { column }, null, null, null);
            if (cursor == null || !cursor.moveToFirst()) {
                return null;
            }
            final int index = cursor.getColumnIndex(column);
            if (index < 0) {
                return null;
            }
            return cursor.getString(index);
        } catch (RuntimeException e) {
            return null;
        } finally {
            if (cursor != null) {
                cursor.close();
            }
        }
    }

    /** Return data contained at a given Uri as Base64. Defaults to null. */
    public static String getDataFromURI(
            final ContentResolver contentResolver,
            final Uri uri) {
        try {
            final InputStream inputStream = contentResolver.openInputStream(uri);
            final byte[] bytes = ByteStreams.toByteArray(inputStream);
            return Base64.encodeToString(bytes, Base64.NO_WRAP);
        }
        catch (IOException e) {
            return "";
        }
    }
}
// vim: ts=4:sw=4:et
