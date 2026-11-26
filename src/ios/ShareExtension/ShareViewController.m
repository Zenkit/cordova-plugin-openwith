//
//  ShareViewController.m
//  OpenWith - Share Extension
//

//
// The MIT License (MIT)
//
// Copyright (c) 2017 Jean-Christophe Hoelt
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.
//

#import <UIKit/UIKit.h>
#import <MobileCoreServices/MobileCoreServices.h>
#import "ShareViewController.h"

// The extension has no UI. It copies the shared items into the App Group
// container, stores them in the shared user defaults and opens the Cordova
// app with its URL scheme.
@interface ShareViewController : UIViewController
@property (nonatomic) int verbosityLevel;
@property (nonatomic,retain) NSUserDefaults *userDefaults;
@property (nonatomic) BOOL didLoadAttachments;
@end

/*
 * Constants
 */

#define VERBOSITY_DEBUG  0
#define VERBOSITY_INFO  10
#define VERBOSITY_WARN  20
#define VERBOSITY_ERROR 30

@implementation ShareViewController

- (void) log:(int)level message:(NSString*)message {
    if (level >= self.verbosityLevel) {
        NSLog(@"[ShareViewController.m]%@", message);
    }
}
- (void) debug:(NSString*)message { [self log:VERBOSITY_DEBUG message:message]; }
- (void) info:(NSString*)message { [self log:VERBOSITY_INFO message:message]; }
- (void) warn:(NSString*)message { [self log:VERBOSITY_WARN message:message]; }
- (void) error:(NSString*)message { [self log:VERBOSITY_ERROR message:message]; }

- (void) setup {
    self.userDefaults = [[NSUserDefaults alloc] initWithSuiteName:SHAREEXT_GROUP_IDENTIFIER];
    self.verbosityLevel = (int)[self.userDefaults integerForKey:@"verbosityLevel"];
    [self debug:@"[setup]"];
}

- (void) viewDidLoad {
    [super viewDidLoad];
    [self setup];
    [self debug:@"[viewDidLoad]"];
}

- (void) viewDidAppear:(BOOL)animated {
    [super viewDidAppear:animated];
    [self debug:@"[viewDidAppear]"];
    if (self.didLoadAttachments) {
        return;
    }
    self.didLoadAttachments = YES;
    [self loadAttachments];
}

- (void) loadAttachments {
    NSMutableArray<NSItemProvider*> *itemProviders = [NSMutableArray array];
    for (NSExtensionItem *extensionItem in self.extensionContext.inputItems) {
        if (extensionItem.attachments != nil) {
            [itemProviders addObjectsFromArray:extensionItem.attachments];
        }
    }

    NSURL *directory = [self createSharedDirectory];
    NSMutableArray *items = [NSMutableArray arrayWithCapacity:itemProviders.count];
    for (NSUInteger i = 0; i < itemProviders.count; i++) {
        [items addObject:[NSNull null]];
    }

    // NOTE: The item providers call their completion handlers on arbitrary queues,
    // so the items are only modified on the main queue. They keep the order of the attachments.
    dispatch_group_t group = dispatch_group_create();
    [itemProviders enumerateObjectsUsingBlock:^(NSItemProvider *itemProvider, NSUInteger index, BOOL *stop) {
        dispatch_group_enter(group);
        [self loadItemProvider:itemProvider directory:directory completion:^(NSDictionary *item) {
            dispatch_async(dispatch_get_main_queue(), ^{
                if (item != nil) {
                    items[index] = item;
                }
                dispatch_group_leave(group);
            });
        }];
    }];

    dispatch_group_notify(group, dispatch_get_main_queue(), ^{
        [items removeObjectIdenticalTo:[NSNull null]];
        [self sendResults:items directory:directory];
    });
}

// Calls the completion exactly once, with nil if the item couldn't be loaded.
- (void) loadItemProvider:(NSItemProvider*)itemProvider directory:(NSURL*)directory completion:(void (^)(NSDictionary *item))completion {
    NSString *urlUTI = (NSString*)kUTTypeURL;
    NSString *fileURLUTI = (NSString*)kUTTypeFileURL;
    NSString *plainTextUTI = (NSString*)kUTTypePlainText;
    NSString *imageUTI = (NSString*)kUTTypeImage;
    NSString *dataUTI = (NSString*)kUTTypeData;

    [self debug:[NSString stringWithFormat:@"item provider registered identifiers = %@", itemProvider.registeredTypeIdentifiers]];

    BOOL conformsToFileURL = [itemProvider hasItemConformingToTypeIdentifier:fileURLUTI];

    // Handle URLs but ignore file URLs
    if (!conformsToFileURL && [itemProvider hasItemConformingToTypeIdentifier:urlUTI]) {
        [self debug:[NSString stringWithFormat:@"loading item as \"%@\"", urlUTI]];
        [itemProvider loadItemForTypeIdentifier:urlUTI options:nil completionHandler:^(NSURL *url, NSError *error) {
            NSString *text = [url isKindOfClass:[NSURL class]] ? url.absoluteString : nil;
            completion([self textItem:text itemProvider:itemProvider defaultUti:urlUTI]);
        }];
    }
    // Handle plain text, ignore file URLs
    else if (!conformsToFileURL && [itemProvider hasItemConformingToTypeIdentifier:plainTextUTI]) {
        [self debug:[NSString stringWithFormat:@"loading item as \"%@\"", plainTextUTI]];
        [itemProvider loadItemForTypeIdentifier:plainTextUTI options:nil completionHandler:^(NSString *text, NSError *error) {
            completion([self textItem:([text isKindOfClass:[NSString class]] ? text : nil) itemProvider:itemProvider defaultUti:plainTextUTI]);
        }];
    }
    // Handle images separately because some apps provide the image not as a file but as an UIImage (e.g. the screenshot editor)
    else if ([itemProvider hasItemConformingToTypeIdentifier:imageUTI] && ![itemProvider hasRepresentationConformingToTypeIdentifier:imageUTI fileOptions:NSItemProviderFileOptionOpenInPlace]) {
        [self debug:[NSString stringWithFormat:@"loading item as \"%@\"", imageUTI]];
        [itemProvider loadItemForTypeIdentifier:imageUTI options:nil completionHandler:^(id<NSSecureCoding> item, NSError *error) {
            NSObject *object = (NSObject*)item;
            if ([object isKindOfClass:[NSURL class]] && ((NSURL*)object).isFileURL) {
                completion([self fileItemFromURL:(NSURL*)object itemProvider:itemProvider directory:directory]);
            } else if ([object isKindOfClass:[UIImage class]]) {
                NSData *data = UIImagePNGRepresentation((UIImage*)object);
                completion([self fileItemFromData:data uti:(NSString*)kUTTypePNG itemProvider:itemProvider directory:directory]);
            } else if ([object isKindOfClass:[NSData class]]) {
                NSString *uti = [self utiOfItemProvider:itemProvider defaultUti:imageUTI];
                completion([self fileItemFromData:(NSData*)object uti:uti itemProvider:itemProvider directory:directory]);
            } else {
                [self warn:[NSString stringWithFormat:@"failed to load image: %@", error]];
                completion(nil);
            }
        }];
    }
    // Handle any other data, load the file in place (or a copy of it if that isn't possible)
    else if ([itemProvider hasItemConformingToTypeIdentifier:dataUTI]) {
        [self debug:[NSString stringWithFormat:@"loading file in place as \"%@\"", dataUTI]];
        [itemProvider loadInPlaceFileRepresentationForTypeIdentifier:dataUTI completionHandler:^(NSURL *fileURL, BOOL isInPlace, NSError *error) {
            if (fileURL == nil) {
                [self warn:[NSString stringWithFormat:@"failed to load file: %@", error]];
            }
            completion([self fileItemFromURL:fileURL itemProvider:itemProvider directory:directory]);
        }];
    }
    else {
        [self warn:@"unsupported item provider"];
        completion(nil);
    }
}

- (NSDictionary*) textItem:(NSString*)text itemProvider:(NSItemProvider*)itemProvider defaultUti:(NSString*)defaultUti {
    if (text.length == 0) {
        return nil;
    }
    NSString *uti = [self utiOfItemProvider:itemProvider defaultUti:defaultUti];
    NSDictionary *item = @{
        @"text": text,
        @"uti": uti,
        @"utis": itemProvider.registeredTypeIdentifiers,
        @"type": [self mimeTypeFromUti:uti],
    };
    [self debug:[NSString stringWithFormat:@"loaded text item = %@", item]];
    return item;
}

- (NSDictionary*) fileItemWithURL:(NSURL*)fileURL name:(NSString*)name uti:(NSString*)uti itemProvider:(NSItemProvider*)itemProvider {
    NSDictionary *item = @{
        @"uti": uti,
        @"name": name,
        @"type": [self mimeTypeFromUti:uti],
        @"uri": fileURL.absoluteString,
        @"utis": itemProvider.registeredTypeIdentifiers,
    };
    [self debug:[NSString stringWithFormat:@"loaded file item = %@", item]];
    return item;
}

// Copy the file to the shared directory so the Cordova app has access to it.
// The URL is only valid until the item provider's completion handler returns.
- (NSDictionary*) fileItemFromURL:(NSURL*)fileURL itemProvider:(NSItemProvider*)itemProvider directory:(NSURL*)directory {
    if (fileURL == nil || directory == nil) {
        return nil;
    }

    // NOTE: Use the name of the provided file, the suggested name might not match its type.
    NSString *fileName = [self sanitizeFileName:fileURL.lastPathComponent];
    NSURL *sharedFileURL = [self sharedFileURLWithName:fileName directory:directory];

    BOOL isSecurityScoped = [fileURL startAccessingSecurityScopedResource];
    NSError *error = nil;
    BOOL copied = [[NSFileManager defaultManager] copyItemAtURL:fileURL toURL:sharedFileURL error:&error];
    if (isSecurityScoped) {
        [fileURL stopAccessingSecurityScopedResource];
    }
    if (!copied) {
        [self warn:[NSString stringWithFormat:@"failed to copy file from \"%@\" to \"%@\": %@", fileURL, sharedFileURL, error]];
        return nil;
    }

    NSString *uti = [self utiOfItemProvider:itemProvider defaultUti:(NSString*)kUTTypeData];
    return [self fileItemWithURL:sharedFileURL name:fileName uti:uti itemProvider:itemProvider];
}

- (NSDictionary*) fileItemFromData:(NSData*)data uti:(NSString*)uti itemProvider:(NSItemProvider*)itemProvider directory:(NSURL*)directory {
    if (data == nil || directory == nil) {
        return nil;
    }

    NSString *baseName = [self sanitizeFileName:itemProvider.suggestedName.stringByDeletingPathExtension];
    if (baseName.length == 0) {
        baseName = @"image";
    }
    NSString *extension = [self extensionFromUti:uti];
    NSString *fileName = extension.length > 0 ? [baseName stringByAppendingPathExtension:extension] : nil;
    if (fileName == nil) {
        fileName = baseName;
    }
    NSURL *sharedFileURL = [self sharedFileURLWithName:fileName directory:directory];

    NSError *error = nil;
    if (![data writeToURL:sharedFileURL options:NSDataWritingAtomic error:&error]) {
        [self warn:[NSString stringWithFormat:@"failed to write file \"%@\": %@", sharedFileURL, error]];
        return nil;
    }

    return [self fileItemWithURL:sharedFileURL name:fileName uti:uti itemProvider:itemProvider];
}

- (NSString*) sanitizeFileName:(NSString*)fileName {
    if (fileName == nil) {
        return nil;
    }
    NSCharacterSet *separators = [NSCharacterSet characterSetWithCharactersInString:@"/:"];
    return [[fileName componentsSeparatedByCharactersInSet:separators] componentsJoinedByString:@"_"];
}

// Every share gets its own directory in the App Group container,
// the Cordova app removes it once it isn't needed anymore.
- (NSURL*) createSharedDirectory {
    NSFileManager *fileManager = [NSFileManager defaultManager];
    NSURL *containerURL = [fileManager containerURLForSecurityApplicationGroupIdentifier:SHAREEXT_GROUP_IDENTIFIER];
    if (containerURL == nil) {
        [self error:[NSString stringWithFormat:@"App Group \"%@\" is not available", SHAREEXT_GROUP_IDENTIFIER]];
        return nil;
    }

    NSURL *directory = [[containerURL URLByAppendingPathComponent:SHAREEXT_SHARED_DIRECTORY isDirectory:YES]
                        URLByAppendingPathComponent:[[NSUUID UUID] UUIDString] isDirectory:YES];
    NSError *error = nil;
    if (![fileManager createDirectoryAtURL:directory withIntermediateDirectories:YES attributes:nil error:&error]) {
        [self error:[NSString stringWithFormat:@"failed to create directory \"%@\": %@", directory, error]];
        return nil;
    }
    return directory;
}

// Prefix the file name to avoid overwriting files with the same name.
- (NSURL*) sharedFileURLWithName:(NSString*)fileName directory:(NSURL*)directory {
    NSString *uuid = [[NSUUID UUID] UUIDString];
    NSString *sharedFileName = [uuid stringByAppendingPathExtension:fileName];
    return [directory URLByAppendingPathComponent:(sharedFileName != nil ? sharedFileName : uuid) isDirectory:NO];
}

- (void) sendResults:(NSArray*)items directory:(NSURL*)directory {
    NSArray *fileItems = [items filteredArrayUsingPredicate:[NSPredicate predicateWithFormat:@"uri != nil"]];
    if (directory != nil && fileItems.count == 0) {
        [[NSFileManager defaultManager] removeItemAtURL:directory error:nil];
    }

    if (items.count > 0) {
        [self.userDefaults setObject:@{ @"items": items } forKey:@"shared"];
        [self.userDefaults synchronize];

        // Emit a URL that opens the cordova app
        NSString *url = [NSString stringWithFormat:@"%@://shared", SHAREEXT_URL_SCHEME];
        [self openURL:[NSURL URLWithString:url]];
    } else {
        [self warn:@"[sendResults] nothing to share"];
    }

    // Inform the host that we're done, so it un-blocks its UI.
    [self.extensionContext completeRequestReturningItems:@[] completionHandler:nil];
}

// Extensions can't use UIApplication.sharedApplication, so the URL is opened by
// the first responder in the chain that is able to (the scene or the application).
- (void) openURL:(nonnull NSURL *)url {
    SEL selector = NSSelectorFromString(@"openURL:options:completionHandler:");

    UIResponder *responder = self;
    while ((responder = [responder nextResponder]) != nil) {
        if (![responder respondsToSelector:selector]) {
            continue;
        }

        // NOTE: The options have a different type depending on the receiver.
        id options = nil;
        if ([responder isKindOfClass:[UIApplication class]]) {
            options = @{};
        } else if (@available(iOS 13.0, *)) {
            if ([responder isKindOfClass:[UIScene class]]) {
                options = [[UISceneOpenExternalURLOptions alloc] init];
            }
        }
        if (options == nil) {
            continue;
        }

        [self debug:[NSString stringWithFormat:@"[openURL] using responder %@", responder]];
        void (^completion)(BOOL success) = ^void(BOOL success) {
            NSLog(@"[ShareViewController.m][openURL] success: %i", success);
        };

        NSMethodSignature *methodSignature = [responder methodSignatureForSelector:selector];
        NSInvocation *invocation = [NSInvocation invocationWithMethodSignature:methodSignature];
        [invocation setTarget:responder];
        [invocation setSelector:selector];
        [invocation setArgument:&url atIndex:2];
        [invocation setArgument:&options atIndex:3];
        [invocation setArgument:&completion atIndex:4];
        [invocation invoke];
        return;
    }

    [self warn:@"[openURL] no responder can open URLs"];
}

- (NSString*) utiOfItemProvider:(NSItemProvider*)itemProvider defaultUti:(NSString*)defaultUti {
    NSString *uti = itemProvider.registeredTypeIdentifiers.firstObject;
    return uti != nil ? uti : defaultUti;
}

- (NSString *)mimeTypeFromUti: (NSString*)uti {
    if (uti == nil) {
        return @"";
    }
    CFStringRef cret = UTTypeCopyPreferredTagWithClass((__bridge CFStringRef)uti, kUTTagClassMIMEType);
    NSString *ret = (__bridge_transfer NSString *)cret;
    return ret == nil ? @"" : ret;
}

- (NSString *)extensionFromUti: (NSString*)uti {
    if (uti == nil) {
        return nil;
    }
    CFStringRef cret = UTTypeCopyPreferredTagWithClass((__bridge CFStringRef)uti, kUTTagClassFilenameExtension);
    return (__bridge_transfer NSString *)cret;
}

@end
