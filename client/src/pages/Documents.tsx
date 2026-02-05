import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Plus, FileText, Upload, Trash2, RefreshCw } from "lucide-react";
import { trpc } from "@/lib/trpc";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";

export default function Documents({ trialId = '1' }: { trialId?: string } = {}) {
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [category, setCategory] = useState("Protocol");
  const [isUploading, setIsUploading] = useState(false);
  const [showCustomCategory, setShowCustomCategory] = useState(false);
  const [customCategory, setCustomCategory] = useState("");

  // Query documents
  const { data: documents, isLoading, refetch } = trpc.documents.list.useQuery({ trialId: trialId });

  // Query categories
  const { data: categories } = trpc.documents.getCategories.useQuery();

  // Upload mutation
  const uploadMutation = trpc.documents.upload.useMutation({
    onSuccess: () => {
      toast.success("Document uploaded successfully");
      setUploadDialogOpen(false);
      setSelectedFile(null);
      refetch();
    },
    onError: (error: any) => {
      toast.error("Failed to upload document", {
        description: error.message,
      });
    },
  });

  // Delete document mutation
  const deleteMutation = trpc.documents.delete.useMutation({
    onSuccess: () => {
      toast.success("Document deleted successfully");
      refetch();
    },
    onError: (error: any) => {
      toast.error("Failed to delete document", {
        description: error.message,
      });
    },
  });

  // Retry processing mutation
  const retryMutation = trpc.documents.retryProcessing.useMutation({
    onSuccess: (data) => {
      toast.success(data.message || "Document processing retried");
      refetch();
    },
    onError: (error: any) => {
      toast.error("Failed to retry processing", {
        description: error.message,
      });
    },
  });

  // Create category mutation
  const createCategoryMutation = trpc.documents.createCategory.useMutation({
    onSuccess: () => {
      toast.success("Category created successfully");
    },
    onError: (error: any) => {
      toast.error("Failed to create category", {
        description: error.message,
      });
    },
  });

  // Update category mutation
  const updateCategoryMutation = trpc.documents.updateCategory.useMutation({
    onSuccess: () => {
      toast.success("Category updated successfully");
      refetch();
    },
    onError: (error: any) => {
      toast.error("Failed to update category", {
        description: error.message,
      });
    },
  });

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFile(file);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      toast.error("Please select a file");
      return;
    }

    setIsUploading(true);

    try {
      // Convert file to base64
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = reader.result as string;
        const base64Data = base64.split(",")[1]; // Remove data:...;base64, prefix

        await uploadMutation.mutateAsync({
          trialId,
          filename: selectedFile.name,
          fileData: base64Data,
          category,
        });
        setIsUploading(false);
      };
      reader.onerror = () => {
        toast.error("Failed to read file");
        setIsUploading(false);
      };
      reader.readAsDataURL(selectedFile);
    } catch (error) {
      setIsUploading(false);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  return (
    <div>
      {/* Documents Table */}
      <div className="bg-white rounded-lg border border-gray-200">
        {/* Header inside container */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-baseline gap-3">
            <h1 className="text-2xl font-semibold text-gray-900">Documents</h1>
            <p className="text-sm text-gray-500">
              {documents?.length || 0} document{documents?.length !== 1 ? "s" : ""}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Dialog open={uploadDialogOpen} onOpenChange={setUploadDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Upload Document
                </Button>
              </DialogTrigger>
              <DialogContent>
            <DialogHeader>
              <DialogTitle>Upload Document</DialogTitle>
              <DialogDescription>
                Upload a protocol or other trial document
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 mt-4">
              {/* Category Selection */}
              <div>
                <label className="text-sm font-medium text-gray-700 mb-2 block">
                  Category
                </label>
                {!showCustomCategory ? (
                  <select
                    value={category}
                    onChange={(e) => {
                      if (e.target.value === "__add_new__") {
                        setShowCustomCategory(true);
                        setCustomCategory("");
                      } else {
                        setCategory(e.target.value);
                      }
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  >
                    {categories?.map((cat) => (
                      <option key={cat.id} value={cat.name}>
                        {cat.name}
                      </option>
                    ))}
                    <option value="__add_new__">+ Add New Category</option>
                  </select>
                ) : (
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={customCategory}
                      onChange={(e) => setCustomCategory(e.target.value)}
                      placeholder="Enter category name"
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-md"
                      autoFocus
                    />
                    <Button
                      variant="outline"
                      onClick={async () => {
                        if (customCategory.trim()) {
                          await createCategoryMutation.mutateAsync({ name: customCategory.trim() });
                          setCategory(customCategory.trim());
                          setShowCustomCategory(false);
                        }
                      }}
                      disabled={!customCategory.trim() || createCategoryMutation.isPending}
                    >
                      Add
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setShowCustomCategory(false);
                        setCustomCategory("");
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                )}
              </div>

              {/* File Upload */}
              <div>
                <label className="text-sm font-medium text-gray-700 mb-2 block">
                  File
                </label>
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-gray-400 transition-colors">
                  <input
                    type="file"
                    accept=".pdf,.doc,.docx"
                    onChange={handleFileSelect}
                    className="hidden"
                    id="file-upload"
                  />
                  <label
                    htmlFor="file-upload"
                    className="cursor-pointer flex flex-col items-center"
                  >
                    <Upload className="h-8 w-8 text-gray-400 mb-2" />
                    {selectedFile ? (
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          {selectedFile.name}
                        </p>
                        <p className="text-xs text-gray-500 mt-1">
                          {formatFileSize(selectedFile.size)}
                        </p>
                      </div>
                    ) : (
                      <div>
                        <p className="text-sm text-gray-600">
                          Click to upload or drag and drop
                        </p>
                        <p className="text-xs text-gray-500 mt-1">
                          PDF, DOC, DOCX up to 50MB
                        </p>
                      </div>
                    )}
                  </label>
                </div>
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-3 mt-6">
                <Button
                  variant="outline"
                  onClick={() => setUploadDialogOpen(false)}
                  disabled={isUploading}
                >
                  Cancel
                </Button>
                <Button onClick={handleUpload} disabled={isUploading || !selectedFile}>
                  {isUploading ? "Uploading..." : "Upload"}
                </Button>
              </div>
            </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Table Header */}
        <div className="grid grid-cols-12 gap-4 px-6 py-3 border-b border-gray-200 bg-gray-50">
          <div className="col-span-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
            File Name
          </div>
          <div className="col-span-2 text-xs font-medium text-gray-500 uppercase tracking-wider">
            Category
          </div>
          <div className="col-span-2 text-xs font-medium text-gray-500 uppercase tracking-wider">
            Size
          </div>
          <div className="col-span-2 text-xs font-medium text-gray-500 uppercase tracking-wider">
            Status
          </div>
          <div className="col-span-2 text-xs font-medium text-gray-500 uppercase tracking-wider">
            Uploaded
          </div>
          <div className="col-span-1 text-xs font-medium text-gray-500 uppercase tracking-wider text-right">
            Actions
          </div>
        </div>

        {/* Table Body */}
        <div>
          {isLoading ? (
            <div className="px-6 py-12 text-center text-gray-500">
              Loading documents...
            </div>
          ) : documents && documents.length > 0 ? (
            documents.map((doc: any) => (
              <div
                key={doc.id}
                className="grid grid-cols-12 gap-4 px-6 py-4 border-b border-gray-100 hover:bg-gray-50 transition-colors"
              >
                {/* File Name */}
                <div className="col-span-3 flex items-center gap-3">
                  <FileText className="h-5 w-5 text-gray-400 flex-shrink-0" />
                  <span className="text-sm text-gray-900 font-medium truncate">
                    {doc.filename}
                  </span>
                </div>

                {/* Category */}
                <div className="col-span-2 flex items-center">
                  <select
                    value={doc.category}
                    onChange={(e) => {
                      updateCategoryMutation.mutate({
                        id: doc.id,
                        category: e.target.value,
                      });
                    }}
                    className="px-2 py-1 bg-blue-50 text-blue-700 text-xs rounded border-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
                    disabled={updateCategoryMutation.isPending}
                  >
                    {categories?.map((cat) => (
                      <option key={cat.id} value={cat.name}>
                        {cat.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Size */}
                <div className="col-span-2 flex items-center">
                  <span className="text-sm text-gray-600">
                    {formatFileSize(doc.fileSize)}
                  </span>
                </div>

                {/* Status */}
                <div className="col-span-2 flex items-center gap-2">
                  {doc.isIndexed ? (
                    <span className="px-2 py-1 bg-green-50 text-green-700 text-xs rounded">
                      Indexed
                    </span>
                  ) : (
                    <>
                      <span className="px-2 py-1 bg-yellow-50 text-yellow-700 text-xs rounded">
                        Processing
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => retryMutation.mutate({ id: doc.id })}
                        disabled={retryMutation.isPending}
                        className="h-6 w-6 p-0 text-yellow-600 hover:text-yellow-700 hover:bg-yellow-50"
                        title="Retry processing"
                      >
                        <RefreshCw className="h-3 w-3" />
                      </Button>
                    </>
                  )}
                </div>

                {/* Uploaded Date */}
                <div className="col-span-2 flex items-center">
                  <span className="text-sm text-gray-600">
                    {formatDate(doc.createdAt)}
                  </span>
                </div>

                {/* Actions */}
                <div className="col-span-1 flex items-center justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      if (confirm(`Delete "${doc.filename}"?`)) {
                        deleteMutation.mutate({ id: doc.id });
                      }
                    }}
                    disabled={deleteMutation.isPending}
                    className="text-red-600 hover:text-red-700 hover:bg-red-50"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))
          ) : (
            <div className="px-6 py-12 text-center">
              <FileText className="h-12 w-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500 text-sm">No documents uploaded yet</p>
              <p className="text-gray-400 text-xs mt-1">
                Upload your first protocol to get started
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
